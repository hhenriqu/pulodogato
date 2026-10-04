-- =====================================================
-- O ACERTO DE GRUPO VIRA LANCAMENTO (HMO-245, fase 11)
-- =====================================================
-- `group_settlements` existe desde a 007 e nunca gerou lancamento nenhum: o
-- unico trigger da tabela e o de `updated_at`. O Pix que uma pessoa manda para
-- a outra era invisivel nos dois lados e o saldo da conta corrente nao se
-- mexia. Era o defeito relatado.
--
-- Esta suite faz O QUE A ROTA FAZ, na sessao `authenticated` de cada pessoa, e
-- mede dinheiro antes e depois. Componente renderizado nao serve aqui: o botao
-- antigo continuaria "funcionando" sem conta nenhuma e passaria verde sem
-- lancar nada.
--
-- O QUE CADA SECAO RESPONDE
-- -------------------------
--   1. quem PAGA sai com a conta MENOR, e a divida do grupo zerada. As duas
--      coisas na mesma secao de proposito: zerar a divida sem mexer na conta e
--      exatamente o estado antigo;
--   2. quem RECEBE sai com a conta MAIOR. O sinal e a unica diferenca entre as
--      duas pernas, e invertido ele afunda a conta de quem acabou de receber;
--   3. `group_id` TEM de ser NULO na perna. Com ele preenchido,
--      `auto_create_group_transaction` rateia o proprio Pix entre os membros --
--      pagar a divida cria divida nova;
--   4. a RLS permite UMA perna so. Esta nao e uma limitacao a contornar: e a
--      objecao 1 da 007 ("nunca mexer na conta de outra pessoa") em vigor, e e
--      ela que define o escopo desta fase;
--   5. desfazer apaga a perna JUNTO. Sem isso a divida volta para a tela com o
--      dinheiro ainda fora da conta -- o estado que convida a pagar duas vezes;
--   6. o painel pessoal de quem recebe continua mostrando A PARTE DELA. E a
--      medicao que decidiu o tipo `transfer` em vez de `income` nos dois lados,
--      e o controle `income` esta aqui para mostrar o numero que ele produz.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 039:
--   psql "$DB_URL" -f database/tests/hmo245_acerto_vira_lancamento_test.sql
--
-- Qualquer FALHA lanca excecao e aborta.
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect_num(label TEXT, got NUMERIC, want NUMERIC)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

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

-- =====================================================
-- Fixture: o hotel da Ana, rateado com a Bia
-- =====================================================
-- Ana paga o hotel de R$ 400 na conta dela. O trigger rateia 200/200. A Bia
-- deve R$ 200 a Ana, e e esse o Pix que as duas secoes seguintes registram.
--
-- Cada uma tem DUAS contas correntes e um cartao: a segunda conta prova que o
-- lancamento cai na conta ESCOLHIDA (uma conta so passaria verde com qualquer
-- id), e o cartao e o controle da recusa.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000a001', 'ana@acerto.local'),
  ('bbbbbbbb-0000-0000-0000-00000000b001', 'bia@acerto.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000a001', 'Ana', FALSE),
  ('bbbbbbbb-0000-0000-0000-00000000b001', 'Bia', FALSE);

INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('99999999-0000-0000-0000-000000000001', 'Viagem',
   'aaaaaaaa-0000-0000-0000-00000000a001');

-- A Ana entra pelo trigger de criacao do grupo; `unique_user_per_group` recusa
-- a segunda insercao dela.
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('99999999-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-00000000b001', 'member', 'active');

INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, current_balance) VALUES
  ('f0000000-0000-0000-0000-0000000000a1',
   'aaaaaaaa-0000-0000-0000-00000000a001', 'Conta Ana', 'checking', 1000),
  ('f0000000-0000-0000-0000-0000000000a2',
   'aaaaaaaa-0000-0000-0000-00000000a001', 'Poupanca Ana', 'savings', 0),
  ('f0000000-0000-0000-0000-0000000000b1',
   'bbbbbbbb-0000-0000-0000-00000000b001', 'Conta Bia', 'checking', 1000),
  ('f0000000-0000-0000-0000-0000000000b2',
   'bbbbbbbb-0000-0000-0000-00000000b001', 'Cartao Bia', 'credit_card', 0);

INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT '70000000-0000-0000-0000-0000000000a1',
       'aaaaaaaa-0000-0000-0000-00000000a001',
       'f0000000-0000-0000-0000-0000000000a1',
       c.service_id, c.id, '99999999-0000-0000-0000-000000000001',
       'Hotel', -400.00, CURRENT_DATE, 'expense'
  FROM public.transaction_categories c
 WHERE c.is_expense = TRUE AND c.user_id IS NULL
 LIMIT 1;

-- Partes aprovadas: `group_share_entries` (033) e a view do painel pessoal, e e
-- ela que a SECAO 6 mede.
UPDATE public.group_expense_splits SET status = 'approved';

SELECT pg_temp.expect_num('fixture: a Bia deve R$ 200 a Ana',
  (SELECT -net_balance FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'
      AND user_id = 'bbbbbbbb-0000-0000-0000-00000000b001'), 200.00);

SELECT pg_temp.expect_num('fixture: a conta da Ana ja sentiu o hotel inteiro',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'f0000000-0000-0000-0000-0000000000a1'), 600.00);

SELECT pg_temp.expect_num('fixture: a conta da Bia nao sentiu nada ainda',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'f0000000-0000-0000-0000-0000000000b1'), 1000.00);

-- =====================================================
-- SECAO 1: a Bia registra que PAGOU -- a conta dela diminui
-- =====================================================
-- Exatamente o que a rota faz, na sessao da Bia: a quitacao, depois a perna.
-- A categoria reservada nasce aqui tambem (a 036 deu a policy de INSERT por
-- usuario) -- sem ela, `category_id NOT NULL` barraria a perna, e esse e um dos
-- modos de falha que so aparecem com RLS de verdade.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-00000000b001';

INSERT INTO public.transaction_categories
  (id, service_id, user_id, name, description, is_expense, is_active)
SELECT 'c0000000-0000-0000-0000-0000000000b1',
       (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
       'bbbbbbbb-0000-0000-0000-00000000b001',
       'Acerto de grupo',
       'Reservada: a perna do acerto de contas de grupo.',
       FALSE, FALSE;

INSERT INTO public.group_settlements
  (id, group_id, from_user_id, to_user_id, amount, currency, exchange_rate,
   settled_on, created_by)
VALUES
  ('a0000000-0000-0000-0000-0000000000b1',
   '99999999-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-00000000b001',
   'aaaaaaaa-0000-0000-0000-00000000a001',
   200.00, 'BRL', 1, CURRENT_DATE,
   'bbbbbbbb-0000-0000-0000-00000000b001');

-- A perna: NEGATIVA, `transfer`, `group_id` NULO, chave em `notes`.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, is_shared,
   description, amount, transaction_date, transaction_type, notes)
SELECT '70000000-0000-0000-0000-0000000000b1',
       'bbbbbbbb-0000-0000-0000-00000000b001',
       'f0000000-0000-0000-0000-0000000000b1',
       (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
       'c0000000-0000-0000-0000-0000000000b1',
       NULL, FALSE,
       'Acerto de grupo — paguei Ana (Viagem)',
       -200.00, CURRENT_DATE, 'transfer',
       'acerto:a0000000-0000-0000-0000-0000000000b1';

RESET ROLE;

SELECT pg_temp.expect_num('DEPOIS: a conta da Bia caiu de 1000 para 800',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'f0000000-0000-0000-0000-0000000000b1'), 800.00);

-- O outro lado da mesma secao: a divida zerou. Zerar a divida SEM mexer na
-- conta e o comportamento antigo, e e por isso que as duas medidas vivem juntas.
SELECT pg_temp.expect_num('DEPOIS: a Bia nao deve mais nada',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'
      AND user_id = 'bbbbbbbb-0000-0000-0000-00000000b001'), 0.00);

-- A conta NAO escolhida nao se mexeu. Sem esta linha, um `account_id` ignorado
-- pela rota passaria verde: todas as medidas acima fecham igual se a perna cair
-- em qualquer conta da pessoa.
SELECT pg_temp.expect_num('a outra conta da Bia (o cartao) continua em zero',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'f0000000-0000-0000-0000-0000000000b2'), 0.00);

-- =====================================================
-- SECAO 2: a Ana registra que RECEBEU -- a conta dela aumenta
-- =====================================================
-- Mesmo acerto, outro lado. `settlements/route.ts` aceita `from_user_id` OU
-- `to_user_id` igual a quem chama, e aqui quem registra e quem recebe.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000a001';

INSERT INTO public.transaction_categories
  (id, service_id, user_id, name, description, is_expense, is_active)
SELECT 'c0000000-0000-0000-0000-0000000000a1',
       (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
       'aaaaaaaa-0000-0000-0000-00000000a001',
       'Acerto de grupo',
       'Reservada: a perna do acerto de contas de grupo.',
       FALSE, FALSE;

INSERT INTO public.group_settlements
  (id, group_id, from_user_id, to_user_id, amount, currency, exchange_rate,
   settled_on, created_by)
VALUES
  ('a0000000-0000-0000-0000-0000000000a1',
   '99999999-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-00000000b001',
   'aaaaaaaa-0000-0000-0000-00000000a001',
   50.00, 'BRL', 1, CURRENT_DATE,
   'aaaaaaaa-0000-0000-0000-00000000a001');

INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, is_shared,
   description, amount, transaction_date, transaction_type, notes)
SELECT '70000000-0000-0000-0000-0000000000a2',
       'aaaaaaaa-0000-0000-0000-00000000a001',
       'f0000000-0000-0000-0000-0000000000a1',
       (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
       'c0000000-0000-0000-0000-0000000000a1',
       NULL, FALSE,
       'Acerto de grupo — Bia me pagou (Viagem)',
       50.00, CURRENT_DATE, 'transfer',
       'acerto:a0000000-0000-0000-0000-0000000000a1';

RESET ROLE;

SELECT pg_temp.expect_num('DEPOIS: a conta da Ana subiu de 600 para 650',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'f0000000-0000-0000-0000-0000000000a1'), 650.00);

-- =====================================================
-- SECAO 3: `group_id` NULO nao e detalhe de estilo
-- =====================================================
-- Com `group_id` preenchido, `auto_create_group_transaction` (024, sobre a
-- regra da 001) ve `group_id IS NOT NULL AND amount < 0` e rateia a linha entre
-- os membros ativos: o Pix de R$ 200 vira despesa nova do grupo, dividida com
-- quem acabou de receber. O SAVEPOINT existe para medir isso e desfazer.
SELECT pg_temp.expect('ANTES: o grupo tem 2 partes (o hotel)',
  (SELECT count(*) FROM public.group_expense_splits), 2::BIGINT);

SAVEPOINT com_group_id;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-00000000b001';

INSERT INTO public.financial_transactions
  (user_id, account_id, service_id, category_id, group_id, is_shared,
   description, amount, transaction_date, transaction_type)
SELECT 'bbbbbbbb-0000-0000-0000-00000000b001',
       'f0000000-0000-0000-0000-0000000000b1',
       (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
       'c0000000-0000-0000-0000-0000000000b1',
       -- O erro que esta secao mede:
       '99999999-0000-0000-0000-000000000001', FALSE,
       'Acerto com group_id (o erro)',
       -200.00, CURRENT_DATE, 'transfer';

RESET ROLE;

SELECT pg_temp.expect('com `group_id`, o Pix e rateado: 2 partes viram 4',
  (SELECT count(*) FROM public.group_expense_splits), 4::BIGINT);

SELECT pg_temp.expect_num('e a soma das partes sai de 400 para 600',
  (SELECT SUM(amount) FROM public.group_expense_splits), 600.00);

ROLLBACK TO SAVEPOINT com_group_id;

SELECT pg_temp.expect('com `group_id` NULO, nenhuma parte nova aparece',
  (SELECT count(*) FROM public.group_expense_splits), 2::BIGINT);

-- =====================================================
-- SECAO 4: a RLS permite UMA perna -- a da propria pessoa
-- =====================================================
-- `financial_transactions_write` e
-- `FOR INSERT WITH CHECK (user_id = auth.uid())`. E por isso que esta fase
-- grava so a perna de quem registra: a da contraparte nao e questao de codigo,
-- e de permissao -- e a permissao esta protegendo a conta de outra pessoa de
-- proposito (objecao 1 da 007).
SAVEPOINT tentativa_na_conta_alheia;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-00000000b001';

DO $$
BEGIN
  INSERT INTO public.financial_transactions
    (user_id, account_id, service_id, category_id, description, amount,
     transaction_date, transaction_type)
  SELECT 'aaaaaaaa-0000-0000-0000-00000000a001',
         'f0000000-0000-0000-0000-0000000000a1',
         (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
         'c0000000-0000-0000-0000-0000000000b1',
         'A perna da Ana, escrita pela Bia', 200.00, CURRENT_DATE, 'transfer';

  RAISE EXCEPTION 'FALHA: a Bia conseguiu lancar na conta da Ana -- a RLS de financial_transactions nao esta protegendo a conta alheia';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: a RLS recusou a perna da contraparte (42501) -- e por isso que a F12 e outra fase';
END $$;

RESET ROLE;

ROLLBACK TO SAVEPOINT tentativa_na_conta_alheia;

-- =====================================================
-- SECAO 5: desfazer apaga a perna JUNTO
-- =====================================================
-- A linha e achada pela chave canonica em `notes` (`acerto:<id>`), porque
-- `financial_transactions` nao tem coluna de acerto. Sem apagar a perna, a
-- divida volta para a sugestao de pagamento com o dinheiro ainda fora da conta
-- -- duas telas afirmando coisas contrarias sobre o mesmo dinheiro.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-00000000b001';

DELETE FROM public.financial_transactions
 WHERE notes = 'acerto:a0000000-0000-0000-0000-0000000000b1';

DELETE FROM public.group_settlements
 WHERE id = 'a0000000-0000-0000-0000-0000000000b1';

RESET ROLE;

SELECT pg_temp.expect_num('desfeito: a conta da Bia voltou a 1000',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'f0000000-0000-0000-0000-0000000000b1'), 1000.00);

SELECT pg_temp.expect_num('desfeito: a divida de R$ 200 voltou (menos os 50 do outro acerto)',
  (SELECT -net_balance FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'
      AND user_id = 'bbbbbbbb-0000-0000-0000-00000000b001'), 150.00);

SELECT pg_temp.expect('desfeito: nao sobrou perna orfa com a chave do acerto',
  (SELECT count(*) FROM public.financial_transactions
    WHERE notes = 'acerto:a0000000-0000-0000-0000-0000000000b1'), 0::BIGINT);

-- A perna do OUTRO acerto continua intacta: a chave carrega o id, e uma chave
-- constante faria um desfazer apagar o lancamento de todos os acertos.
SELECT pg_temp.expect('a perna do outro acerto continua la',
  (SELECT count(*) FROM public.financial_transactions
    WHERE notes = 'acerto:a0000000-0000-0000-0000-0000000000a1'), 1::BIGINT);

-- =====================================================
-- SECAO 6: o painel pessoal continua mostrando A MINHA PARTE
-- =====================================================
-- A medicao que decidiu o tipo. `personal_category_monthly_totals` (033) e o
-- pessoal (`group_id IS NULL`) MAIS a minha parte das despesas de grupo, e ela
-- ignora `transfer`.
--
-- A Ana consumiu R$ 200 de hotel e recebeu R$ 50 de volta. O painel dela tem de
-- continuar dizendo que ela gastou a parte dela -- o reembolso nao e receita,
-- e dinheiro adiantado voltando.
SELECT pg_temp.expect_num('com `transfer`, a despesa da Ana continua sendo a parte dela',
  (SELECT expense FROM public.personal_monthly_cash_flow
    WHERE user_id = 'aaaaaaaa-0000-0000-0000-00000000a001'), 200.00);

SELECT pg_temp.expect_num('com `transfer`, o acerto NAO entra como receita',
  (SELECT income FROM public.personal_monthly_cash_flow
    WHERE user_id = 'aaaaaaaa-0000-0000-0000-00000000a001'), 0.00);

SELECT pg_temp.expect_num('com `transfer`, o resultado do mes da Ana e a parte dela',
  (SELECT net FROM public.personal_monthly_cash_flow
    WHERE user_id = 'aaaaaaaa-0000-0000-0000-00000000a001'), -200.00);

-- O CONTROLE QUE MOSTRA O NUMERO DA OUTRA ESCOLHA.
--
-- Trocando o tipo da perna de quem recebe para `income` -- e so o tipo, nada
-- mais --, o painel da Ana passa a somar o reembolso como receita e o mes dela
-- fecha R$ 50 melhor do que foi. Em cima de um acerto que cobrisse a divida
-- inteira, o mes fecharia empatado: a propria parte dela, apagada.
SAVEPOINT tipo_income;

UPDATE public.financial_transactions
   SET transaction_type = 'income'
 WHERE notes = 'acerto:a0000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_num('CONTROLE: com `income`, o reembolso vira receita de 50',
  (SELECT income FROM public.personal_monthly_cash_flow
    WHERE user_id = 'aaaaaaaa-0000-0000-0000-00000000a001'), 50.00);

SELECT pg_temp.expect_num('CONTROLE: e o mes da Ana fecha 50 melhor do que foi',
  (SELECT net FROM public.personal_monthly_cash_flow
    WHERE user_id = 'aaaaaaaa-0000-0000-0000-00000000a001'), -150.00);

ROLLBACK TO SAVEPOINT tipo_income;

SELECT pg_temp.expect_num('restaurado: de volta a -200 com `transfer`',
  (SELECT net FROM public.personal_monthly_cash_flow
    WHERE user_id = 'aaaaaaaa-0000-0000-0000-00000000a001'), -200.00);

-- A perna aparece no extrato da pessoa de qualquer forma: `transfer` fica fora
-- de Receitas e Despesas, nao da LISTA. Quem recebeu o Pix precisa ve-lo.
SELECT pg_temp.expect('a perna esta na lista de lancamentos da Ana',
  (SELECT count(*) FROM public.financial_transactions
    WHERE user_id = 'aaaaaaaa-0000-0000-0000-00000000a001'
      AND notes = 'acerto:a0000000-0000-0000-0000-0000000000a1'), 1::BIGINT);

SELECT pg_temp.expect_text('e ela diz de quem veio',
  (SELECT description FROM public.financial_transactions
    WHERE notes = 'acerto:a0000000-0000-0000-0000-0000000000a1'),
  'Acerto de grupo — Bia me pagou (Viagem)');

ROLLBACK;
