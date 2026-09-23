-- =====================================================
-- Teste do acerto de contas do grupo (007)
-- =====================================================
-- Responde o que o 007 sozinho nao prova:
--   1. o SINAL do acerto -- registrar um pagamento APROXIMA o saldo de zero.
--      O erro simetrico (somar em quem paga) DOBRA a divida a cada Pix
--      registrado, e a tela mostraria a sugestao crescendo depois de pagar;
--   2. a view soma o pago com ABS (despesa e gravada negativa neste banco) e
--      ignora o rateio rejeitado;
--   3. os dois membros do mesmo grupo leem o MESMO saldo -- e o que o backfill
--      de group_id e a correcao da rota entregam. Sem eles, cada um ve os
--      outros tendo pago zero, sem erro nenhum aparecer;
--   4. um grupo nao enxerga o acerto de outro, e a view respeita a RLS das
--      tabelas base (security_invoker);
--   5. quem nao e parte no pagamento nao consegue registra-lo -- seria o botao
--      de perdoar a divida alheia, aberto a qualquer membro;
--   6. o trigger de saldo corrigido: editar um lancamento nao cobra duas vezes,
--      e mover de conta nao deixa o valor nas duas.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 007:
--   psql "$DB_URL" -f database/tests/group_settlement_test.sql
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

-- =====================================================
-- Fixture: uma viagem de tres pessoas
-- =====================================================
-- Ana paga o hotel (R$ 300), Bia paga a gasolina (R$ 90), Caio nao paga nada.
-- Tudo dividido igualmente por tres, pelo trigger auto_create_group_transaction.
--   Ana  pagou 300, deve 130  ->  +170
--   Bia  pagou  90, deve 130  ->   -40
--   Caio pagou   0, deve 130  ->  -130
-- A soma dos tres tem que ser exatamente zero.
--
-- Dora fica FORA do grupo, e existe so para provar o isolamento.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000a001', 'ana@viagem.local'),
  ('bbbbbbbb-0000-0000-0000-00000000b001', 'bia@viagem.local'),
  ('cccccccc-0000-0000-0000-00000000c001', 'caio@viagem.local'),
  ('dddddddd-0000-0000-0000-00000000d001', 'dora@fora.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000a001', 'Ana',  FALSE),
  ('bbbbbbbb-0000-0000-0000-00000000b001', 'Bia',  FALSE),
  ('cccccccc-0000-0000-0000-00000000c001', 'Caio', FALSE),
  ('dddddddd-0000-0000-0000-00000000d001', 'Dora', FALSE);

INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('99999999-0000-0000-0000-000000000001', 'Viagem',
   'aaaaaaaa-0000-0000-0000-00000000a001'),
  ('99999999-0000-0000-0000-000000000002', 'Outro grupo',
   'dddddddd-0000-0000-0000-00000000d001');

-- O trigger add_group_creator ja inseriu Ana (e Dora, no outro grupo) como
-- admin; faltam Bia e Caio.
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('99999999-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000b001', 'member', 'active'),
  ('99999999-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-00000000c001', 'member', 'active');

SELECT pg_temp.expect('a viagem tem 3 membros ativos',
  (SELECT count(*) FROM public.group_members
    WHERE group_id = '99999999-0000-0000-0000-000000000001' AND status = 'active'), 3);

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('f0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000a001', 'Conta Ana', 'checking', 1000),
  ('f0000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-00000000a001', 'Conta Ana 2', 'checking', 0),
  ('f0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-00000000b001', 'Conta Bia', 'checking', 500);

-- As despesas. amount NEGATIVO, como o app grava: a view tem que somar com ABS.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT '70000000-0000-0000-0000-0000000000a1',
       'aaaaaaaa-0000-0000-0000-00000000a001',
       'f0000000-0000-0000-0000-0000000000a1',
       c.service_id, c.id, '99999999-0000-0000-0000-000000000001',
       'Hotel', -300.00, CURRENT_DATE, 'expense'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT '70000000-0000-0000-0000-0000000000b1',
       'bbbbbbbb-0000-0000-0000-00000000b001',
       'f0000000-0000-0000-0000-0000000000b1',
       c.service_id, c.id, '99999999-0000-0000-0000-000000000001',
       'Gasolina', -90.00, CURRENT_DATE, 'expense'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

-- O trigger auto_create_group_transaction rateia igualmente entre os ativos.
SELECT pg_temp.expect('as duas despesas foram ligadas ao grupo',
  (SELECT count(*) FROM public.group_transactions
    WHERE group_id = '99999999-0000-0000-0000-000000000001'), 2);

SELECT pg_temp.expect('o rateio automatico criou 3 partes por despesa',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.group_id = '99999999-0000-0000-0000-000000000001'), 6);

-- =====================================================
-- 1. Os saldos antes de qualquer acerto
-- =====================================================
SELECT pg_temp.expect_num('Ana pagou 300 (ABS do valor negativo)',
  (SELECT total_paid FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'
      AND user_id = 'aaaaaaaa-0000-0000-0000-00000000a001'), 300.00);

SELECT pg_temp.expect_num('Ana deve 130 da propria parte',
  (SELECT total_owed FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'
      AND user_id = 'aaaaaaaa-0000-0000-0000-00000000a001'), 130.00);

SELECT pg_temp.expect_num('saldo da Ana: +170, tem a receber',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'
      AND user_id = 'aaaaaaaa-0000-0000-0000-00000000a001'), 170.00);

SELECT pg_temp.expect_num('saldo da Bia: -40, deve',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'
      AND user_id = 'bbbbbbbb-0000-0000-0000-00000000b001'), -40.00);

SELECT pg_temp.expect_num('saldo do Caio: -130, deve',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'
      AND user_id = 'cccccccc-0000-0000-0000-00000000c001'), -130.00);

-- A invariante que resume tudo: grupo fechado soma zero.
SELECT pg_temp.expect_num('a soma dos saldos do grupo e zero',
  (SELECT SUM(net_balance) FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'), 0.00);

-- =====================================================
-- 2. O SINAL DO ACERTO -- a assercao que mais importa
-- =====================================================
-- Caio deve 130 e paga os 130 para a Ana. Depois disso:
--   Caio tem que ir de -130 para  0   (a divida foi quitada)
--   Ana  tem que ir de +170 para +40  (recebeu parte do que tinha a receber)
--
-- Somar no pagador e subtrair no recebedor -- o erro simetrico, que e o que
-- sai de "pagamento entra como credito de quem pagou" lido rapido -- levaria
-- Caio a -260: a divida DOBRA a cada pagamento registrado, e a tela passa a
-- sugerir uma transferencia maior depois de cada Pix. Nenhum erro aparece.
INSERT INTO public.group_settlements
  (group_id, from_user_id, to_user_id, amount, created_by, note)
VALUES
  ('99999999-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-00000000c001',
   'aaaaaaaa-0000-0000-0000-00000000a001',
   130.00, 'cccccccc-0000-0000-0000-00000000c001', 'Pix da viagem');

SELECT pg_temp.expect_num('Caio pagou e ZEROU (nao foi para -260)',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'
      AND user_id = 'cccccccc-0000-0000-0000-00000000c001'), 0.00);

SELECT pg_temp.expect_num('Ana recebeu e caiu de +170 para +40',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'
      AND user_id = 'aaaaaaaa-0000-0000-0000-00000000a001'), 40.00);

SELECT pg_temp.expect_num('a Bia nao foi afetada pelo acerto dos outros',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'
      AND user_id = 'bbbbbbbb-0000-0000-0000-00000000b001'), -40.00);

SELECT pg_temp.expect_num('e a soma continua zero depois do acerto',
  (SELECT SUM(net_balance) FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'), 0.00);

-- Acerto apagado devolve a divida: o registro e a unica fonte do abatimento,
-- nenhum saldo ficou congelado numa coluna.
DELETE FROM public.group_settlements
 WHERE group_id = '99999999-0000-0000-0000-000000000001';

SELECT pg_temp.expect_num('desfazer o acerto devolve o Caio para -130',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'
      AND user_id = 'cccccccc-0000-0000-0000-00000000c001'), -130.00);

INSERT INTO public.group_settlements
  (id, group_id, from_user_id, to_user_id, amount, created_by)
VALUES
  ('50000000-0000-0000-0000-000000000001',
   '99999999-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-00000000c001',
   'aaaaaaaa-0000-0000-0000-00000000a001',
   130.00, 'cccccccc-0000-0000-0000-00000000c001');

-- =====================================================
-- 3. Rateio rejeitado nao e divida
-- =====================================================
-- As duas rotas antigas somavam todo rateio, inclusive o recusado: quem
-- clicasse "nao concordo" continuava devendo. Filtrar por 'approved' seria o
-- erro oposto -- o app cria tudo como 'pending' e nada nunca aprova, entao
-- zeraria o saldo de todo mundo.
UPDATE public.group_expense_splits es
   SET status = 'rejected'
  FROM public.group_members m
 WHERE es.member_id = m.id
   AND m.user_id = 'bbbbbbbb-0000-0000-0000-00000000b001'
   AND es.group_transaction_id IN (
     SELECT id FROM public.group_transactions
      WHERE transaction_id = '70000000-0000-0000-0000-0000000000a1');

SELECT pg_temp.expect_num('parte recusada do hotel sai da divida da Bia (130 -> 30)',
  (SELECT total_owed FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'
      AND user_id = 'bbbbbbbb-0000-0000-0000-00000000b001'), 30.00);

-- E o rateio 'pending' CONTINUA valendo, que e o estado de tudo no app hoje.
SELECT pg_temp.expect_num('o rateio pendente do Caio continua sendo divida',
  (SELECT total_owed FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'
      AND user_id = 'cccccccc-0000-0000-0000-00000000c001'), 130.00);

-- Volta ao estado normal para os testes de RLS abaixo.
UPDATE public.group_expense_splits SET status = 'pending' WHERE status = 'rejected';

-- =====================================================
-- 4. Dois membros do mesmo grupo leem o MESMO saldo
-- =====================================================
-- Este e o teste do backfill de group_id. A policy de SELECT de
-- financial_transactions so libera a transacao de outra pessoa quando
-- group_id esta preenchido. Com a coluna vazia -- como a rota do grupo gravava
-- ate hoje -- a Bia veria a Ana tendo pago ZERO, e as duas abririam a mesma
-- viagem com numeros diferentes.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-00000000b001';

SELECT pg_temp.expect_num('a Bia enxerga os 300 que a Ana pagou',
  (SELECT total_paid FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'
      AND user_id = 'aaaaaaaa-0000-0000-0000-00000000a001'), 300.00);

SELECT pg_temp.expect_num('e le o saldo da Ana igual ao que a propria Ana le',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'
      AND user_id = 'aaaaaaaa-0000-0000-0000-00000000a001'), 40.00);

SELECT pg_temp.expect('a Bia enxerga os 3 membros da viagem',
  (SELECT count(*) FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'), 3);

SELECT pg_temp.expect('a Bia enxerga o acerto entre Caio e Ana',
  (SELECT count(*) FROM public.group_settlements), 1);

-- =====================================================
-- 5. Perdoar a divida alheia nao pode
-- =====================================================
-- A Bia nao e parte no par (Caio -> Ana). Deixar qualquer membro registrar
-- pagamento entre outros dois seria um botao de apagar divida dos outros.
DO $$
BEGIN
  INSERT INTO public.group_settlements
    (group_id, from_user_id, to_user_id, amount, created_by)
  VALUES ('99999999-0000-0000-0000-000000000001',
          'cccccccc-0000-0000-0000-00000000c001',
          'aaaaaaaa-0000-0000-0000-00000000a001',
          40.00, 'bbbbbbbb-0000-0000-0000-00000000b001');
  RAISE EXCEPTION 'FALHA: a Bia registrou um acerto entre Caio e Ana';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: a Bia nao registra acerto de que nao participa';
END $$;

-- Nem forjando o created_by de outro.
DO $$
BEGIN
  INSERT INTO public.group_settlements
    (group_id, from_user_id, to_user_id, amount, created_by)
  VALUES ('99999999-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-00000000b001',
          'aaaaaaaa-0000-0000-0000-00000000a001',
          40.00, 'cccccccc-0000-0000-0000-00000000c001');
  RAISE EXCEPTION 'FALHA: a Bia gravou um acerto em nome do Caio';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: created_by preso a quem esta logado';
END $$;

-- Apagar o acerto do Caio tambem nao: quem registrou desfaz.
DO $$
BEGIN
  DELETE FROM public.group_settlements
   WHERE id = '50000000-0000-0000-0000-000000000001';
  IF FOUND THEN
    RAISE EXCEPTION 'FALHA: a Bia apagou o acerto registrado pelo Caio';
  END IF;
  RAISE NOTICE 'ok: a Bia nao apaga o acerto do Caio';
END $$;

-- Mas o proprio par pode registrar: a Bia deve 40 para a Ana e paga.
INSERT INTO public.group_settlements
  (group_id, from_user_id, to_user_id, amount, created_by)
VALUES ('99999999-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-00000000b001',
        'aaaaaaaa-0000-0000-0000-00000000a001',
        40.00, 'bbbbbbbb-0000-0000-0000-00000000b001');

SELECT pg_temp.expect_num('a Bia quitou e zerou',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'
      AND user_id = 'bbbbbbbb-0000-0000-0000-00000000b001'), 0.00);

SELECT pg_temp.expect_num('viagem inteira acertada: todo mundo em zero',
  (SELECT SUM(ABS(net_balance)) FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'), 0.00);

RESET ROLE;

-- =====================================================
-- 6. Quem nao e do grupo nao ve nada
-- =====================================================
-- Sem security_invoker na view, a Dora leria o saldo de TODOS os grupos do
-- sistema: quanto cada casal gasta e com quem cada um viaja.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'dddddddd-0000-0000-0000-00000000d001';

SELECT pg_temp.expect('a Dora nao ve nenhum saldo da viagem alheia',
  (SELECT count(*) FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'), 0);

SELECT pg_temp.expect('a Dora nao ve nenhum acerto alheio',
  (SELECT count(*) FROM public.group_settlements), 0);

SELECT pg_temp.expect('a Dora ve so o proprio grupo',
  (SELECT count(*) FROM public.group_member_balances), 1);

RESET ROLE;

-- =====================================================
-- 7. anon nao toca em nada disso
-- =====================================================
-- A chave anon vai embutida no bundle JS publico.
SET LOCAL ROLE anon;

DO $$
BEGIN
  PERFORM 1 FROM public.group_settlements;
  RAISE EXCEPTION 'FALHA: anon leu group_settlements';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: anon sem privilegio em group_settlements';
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.group_member_balances;
  RAISE EXCEPTION 'FALHA: anon leu group_member_balances';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: anon sem privilegio em group_member_balances';
END $$;

RESET ROLE;

-- =====================================================
-- 8. O trigger de saldo que cobrava duas vezes
-- =====================================================
-- A versao de producao soma NEW.amount no UPDATE sem estornar OLD.amount.
-- Editar a descricao de uma despesa de R$ 300 tirava outros R$ 300 do saldo,
-- em silencio. A conta da Ana comecou com 1000 e ja tem a despesa de 300.
SELECT pg_temp.expect_num('saldo da Ana apos a despesa: 700',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'f0000000-0000-0000-0000-0000000000a1'), 700.00);

UPDATE public.financial_transactions
   SET description = 'Hotel Ibis'
 WHERE id = '70000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_num('editar so a descricao NAO mexe no saldo (era 400 antes do 007)',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'f0000000-0000-0000-0000-0000000000a1'), 700.00);

UPDATE public.financial_transactions
   SET amount = -500.00
 WHERE id = '70000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_num('mudar o valor de 300 para 500 leva o saldo a 500',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'f0000000-0000-0000-0000-0000000000a1'), 500.00);

-- Mover de conta: o ramo que a versao antiga errava DUAS vezes -- deixava o
-- valor na conta de origem e somava de novo na de destino.
UPDATE public.financial_transactions
   SET account_id = 'f0000000-0000-0000-0000-0000000000a2'
 WHERE id = '70000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_num('a conta de origem foi restituida: 1000',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'f0000000-0000-0000-0000-0000000000a1'), 1000.00);

SELECT pg_temp.expect_num('e a de destino ficou com -500',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'f0000000-0000-0000-0000-0000000000a2'), -500.00);

DELETE FROM public.financial_transactions
 WHERE id = '70000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_num('apagar a despesa devolve a conta de destino a zero',
  (SELECT current_balance FROM public.financial_accounts
    WHERE id = 'f0000000-0000-0000-0000-0000000000a2'), 0.00);

-- =====================================================
-- 9. Invariantes da tabela de acerto
-- =====================================================
DO $$
BEGIN
  INSERT INTO public.group_settlements
    (group_id, from_user_id, to_user_id, amount, created_by)
  VALUES ('99999999-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000a001',
          'aaaaaaaa-0000-0000-0000-00000000a001',
          10.00, 'aaaaaaaa-0000-0000-0000-00000000a001');
  RAISE EXCEPTION 'FALHA: acerto de alguem consigo mesmo foi aceito';
EXCEPTION
  WHEN check_violation THEN
    RAISE NOTICE 'ok: nao da para acertar consigo mesmo';
END $$;

DO $$
BEGIN
  INSERT INTO public.group_settlements
    (group_id, from_user_id, to_user_id, amount, created_by)
  VALUES ('99999999-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-00000000b001',
          'aaaaaaaa-0000-0000-0000-00000000a001',
          -10.00, 'bbbbbbbb-0000-0000-0000-00000000b001');
  RAISE EXCEPTION 'FALHA: acerto de valor negativo foi aceito';
EXCEPTION
  WHEN check_violation THEN
    RAISE NOTICE 'ok: o valor do acerto e sempre positivo';
END $$;

-- =====================================================
-- 10. O rateio tem que somar o valor da despesa, ate o centavo
-- =====================================================
-- R$ 100 por 3 e o caso que a versao antiga errava: 33,33% de 100 = 33,33,
-- tres vezes = 99,99, e R$ 0,01 some. Nao e cosmetico -- e o centavo que
-- impede o grupo de fechar em zero, e portanto o acerto de terminar.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT '70000000-0000-0000-0000-0000000000c1',
       'cccccccc-0000-0000-0000-00000000c001',
       NULL, c.service_id, c.id, '99999999-0000-0000-0000-000000000001',
       'Jantar', -100.00, CURRENT_DATE, 'expense'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

SELECT pg_temp.expect_num('R$ 100 por 3 rateia exatamente R$ 100 (era 99,99)',
  (SELECT SUM(es.amount) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000c1'), 100.00);

SELECT pg_temp.expect('e o centavo extra vai para UM so membro',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000c1'
      AND es.amount = 33.34), 1);

-- A invariante geral: nenhuma despesa do grupo pode ter rateio que nao soma o
-- proprio valor. Vale para as tres despesas da fixture de uma vez.
-- O count(*) precisa ficar FORA do GROUP BY: por dentro ele conta linhas de
-- cada grupo, e quando nenhum grupo sobrevive ao HAVING o escalar vem NULL --
-- que nao e zero e passaria por "nenhuma despesa com problema" num
-- `expect(..., 0)` mais descuidado. Foi o que esta assercao fez na primeira
-- versao, e o proprio teste pegou.
SELECT pg_temp.expect('nenhuma despesa do grupo perde centavo no rateio',
  (SELECT count(*) FROM (
     SELECT gt.id
       FROM public.group_transactions gt
       JOIN public.financial_transactions ft ON ft.id = gt.transaction_id
       LEFT JOIN public.group_expense_splits es ON es.group_transaction_id = gt.id
      WHERE gt.group_id = '99999999-0000-0000-0000-000000000001'
      GROUP BY gt.id, ft.amount
     HAVING COALESCE(SUM(es.amount), 0) <> ABS(ft.amount)
   ) AS desbalanceadas), 0);

-- =====================================================
-- 11. Rateio personalizado nao pode ser achatado para igual
-- =====================================================
-- O trigger nao tinha clausula WHEN nem olhava o split_type: reescrevia como
-- igualitario TODO rateio inserido, inclusive o combinado 70/30 e o
-- proporcional a renda que o endpoint /expense-groups/proportions calcula.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, description,
   amount, transaction_date, transaction_type)
SELECT '70000000-0000-0000-0000-0000000000d1',
       'aaaaaaaa-0000-0000-0000-00000000a001',
       NULL, c.service_id, c.id, 'Aluguel', -1000.00, CURRENT_DATE, 'expense'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

-- group_id fica NULL de proposito: o trigger automatico nao entra, e o rateio
-- custom e inserido a mao, como a rota faz.
INSERT INTO public.group_transactions (id, group_id, transaction_id, split_type)
VALUES ('60000000-0000-0000-0000-000000000001',
        '99999999-0000-0000-0000-000000000001',
        '70000000-0000-0000-0000-0000000000d1', 'custom');

INSERT INTO public.group_expense_splits (group_transaction_id, member_id, percentage, amount, status)
SELECT '60000000-0000-0000-0000-000000000001', m.id,
       CASE WHEN m.user_id = 'aaaaaaaa-0000-0000-0000-00000000a001' THEN 70.00 ELSE 15.00 END,
       CASE WHEN m.user_id = 'aaaaaaaa-0000-0000-0000-00000000a001' THEN 700.00 ELSE 150.00 END,
       'pending'
  FROM public.group_members m
 WHERE m.group_id = '99999999-0000-0000-0000-000000000001' AND m.status = 'active';

SELECT pg_temp.expect_num('a parte de 70% da Ana ficou 700, nao 333,34',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_members m ON m.id = es.member_id
    WHERE es.group_transaction_id = '60000000-0000-0000-0000-000000000001'
      AND m.user_id = 'aaaaaaaa-0000-0000-0000-00000000a001'), 700.00);

SELECT pg_temp.expect_num('e as partes de 15% ficaram 150',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_members m ON m.id = es.member_id
    WHERE es.group_transaction_id = '60000000-0000-0000-0000-000000000001'
      AND m.user_id = 'bbbbbbbb-0000-0000-0000-00000000b001'), 150.00);

SELECT pg_temp.expect_num('a porcentagem combinada tambem sobreviveu',
  (SELECT es.percentage FROM public.group_expense_splits es
     JOIN public.group_members m ON m.id = es.member_id
    WHERE es.group_transaction_id = '60000000-0000-0000-0000-000000000001'
      AND m.user_id = 'aaaaaaaa-0000-0000-0000-00000000a001'), 70.00);

ROLLBACK;
