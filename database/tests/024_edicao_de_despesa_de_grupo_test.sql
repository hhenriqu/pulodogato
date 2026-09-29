-- =====================================================
-- Teste da edicao de despesa de grupo (024)
-- =====================================================
-- HMO-176. Antes da 024, editar uma despesa que ja esta num grupo nao refazia
-- a divisao, de duas formas:
--
--   1. mudar o VALOR deixava as partes velhas -- hotel de R$ 300 virando
--      R$ 600 deixava tres partes de R$ 100, e a soma dos saldos do grupo, que
--      tem que ser zero, ia para R$ 300 (medido);
--   2. trocar o GRUPO cobrava nos dois -- `Casa 1 parte / R$ 600` e
--      `Viagem 3 partes / R$ 300` na mesma despesa (medido).
--
-- O que este arquivo prova, alem do obvio:
--
--   * o recalculo passa pelo maior resto do 007, e nao por uma divisao nova:
--     R$ 100 entre 3 depois da edicao da 33,34 / 33,33 / 33,33 e soma exata;
--   * a opcao (b) escolhida na issue: parte ja aprovada TRAVA a edicao, com
--     SQLSTATE PDG01, e nada e gravado -- nem o valor da transacao;
--   * parte recusada NAO trava e NAO e recalculada (ressuscitar recusa seria o
--     erro simetrico);
--   * rateio combinado (percentage/custom) e reescalado pela porcentagem
--     gravada, nao achatado para partes iguais -- a regressao que a 007 tirou;
--   * a edicao funciona pela RLS de um membro COMUM. Este e o controle que
--     separa a correcao de verdade da correcao que so passa no teste: em
--     SECURITY INVOKER o DELETE de group_expense_splits exige is_group_admin e
--     afetaria ZERO linhas, em silencio, para quem nao e admin;
--   * sobrou UM trigger de grupo em financial_transactions, nao dois.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 024:
--   psql "$DB_URL" -f database/tests/024_edicao_de_despesa_de_grupo_test.sql
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
-- Fixture: a mesma viagem de tres, mais um grupo "Casa"
-- =====================================================
-- Ana cria os dois grupos (e entra como admin pelo trigger add_group_creator).
-- Bia e Caio entram na Viagem; Bia tambem entra na Casa. Bia e membro COMUM
-- nos dois, e e ela quem edita na SECAO 6.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000a001', 'ana@viagem.local'),
  ('bbbbbbbb-0000-0000-0000-00000000b001', 'bia@viagem.local'),
  ('cccccccc-0000-0000-0000-00000000c001', 'caio@viagem.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000a001', 'Ana',  FALSE),
  ('bbbbbbbb-0000-0000-0000-00000000b001', 'Bia',  FALSE),
  ('cccccccc-0000-0000-0000-00000000c001', 'Caio', FALSE);

INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('99999999-0000-0000-0000-000000000001', 'Viagem', 'aaaaaaaa-0000-0000-0000-00000000a001'),
  ('99999999-0000-0000-0000-000000000003', 'Casa',   'aaaaaaaa-0000-0000-0000-00000000a001');

INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('99999999-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000b001', 'member', 'active'),
  ('99999999-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-00000000c001', 'member', 'active'),
  ('99999999-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-00000000b001', 'member', 'active');

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('f0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000a001', 'Conta Ana', 'checking', 5000),
  ('f0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-00000000b001', 'Conta Bia', 'checking', 5000);

-- Hotel de R$ 300 pago pela Ana, na Viagem. amount NEGATIVO, como o app grava.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT '70000000-0000-0000-0000-0000000000a1',
       'aaaaaaaa-0000-0000-0000-00000000a001',
       'f0000000-0000-0000-0000-0000000000a1',
       c.service_id, c.id, '99999999-0000-0000-0000-000000000001',
       'Hotel', -300.00, CURRENT_DATE, 'expense'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

SELECT pg_temp.expect('o hotel nasceu com 3 partes',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000a1'), 3);

SELECT pg_temp.expect_num('e cada parte e de R$ 100',
  (SELECT DISTINCT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000a1'), 100.00);

-- =====================================================
-- 1. O CASO 1: mudar o valor refaz as partes
-- =====================================================
UPDATE public.financial_transactions SET amount = -600.00
 WHERE id = '70000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect('continuam 3 partes (nao 6)',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000a1'), 3);

SELECT pg_temp.expect_num('cada parte virou R$ 200',
  (SELECT DISTINCT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000a1'), 200.00);

-- A assercao que resume o estrago: com as partes velhas isto dava 300.00.
SELECT pg_temp.expect_num('a soma dos saldos do grupo volta a ser zero',
  (SELECT SUM(net_balance) FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'), 0.00);

-- =====================================================
-- 2. Os centavos: o recalculo usa o maior resto do 007
-- =====================================================
-- R$ 100 entre 3 nao tem resposta de duas casas. A divisao ingenua daria
-- 33,33 tres vezes -- 99,99, e o centavo que falta vira saldo residual que
-- nenhum pagamento zera. O 007 resolveu isso no INSERT; este teste exige que
-- a EDICAO passe pelo mesmo caminho em vez de inventar o proprio.
UPDATE public.financial_transactions SET amount = -100.00
 WHERE id = '70000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_num('as tres partes de R$ 100 somam exatamente 100,00',
  (SELECT SUM(es.amount) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000a1'), 100.00);

SELECT pg_temp.expect('uma das partes leva o centavo que sobra (33,34)',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000a1'
      AND es.amount = 33.34), 1);

SELECT pg_temp.expect_num('e a soma dos saldos continua zero com centavo quebrado',
  (SELECT SUM(net_balance) FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'), 0.00);

-- Volta para R$ 300 para as secoes seguintes lerem numeros redondos.
UPDATE public.financial_transactions SET amount = -300.00
 WHERE id = '70000000-0000-0000-0000-0000000000a1';

-- =====================================================
-- 3. O CASO 2: trocar de grupo nao cobra nos dois
-- =====================================================
UPDATE public.financial_transactions SET group_id = '99999999-0000-0000-0000-000000000003'
 WHERE id = '70000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect('o hotel tem UMA divisao (era 2)',
  (SELECT count(*) FROM public.group_transactions
    WHERE transaction_id = '70000000-0000-0000-0000-0000000000a1'), 1);

SELECT pg_temp.expect('e ela esta na Casa',
  (SELECT count(*) FROM public.group_transactions
    WHERE transaction_id = '70000000-0000-0000-0000-0000000000a1'
      AND group_id = '99999999-0000-0000-0000-000000000003'), 1);

SELECT pg_temp.expect('a Viagem nao tem mais nenhuma parte do hotel',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.group_id = '99999999-0000-0000-0000-000000000001'
      AND gt.transaction_id = '70000000-0000-0000-0000-0000000000a1'), 0);

-- A Casa tem 2 membros ativos (Ana e Bia): R$ 150 cada, somando os R$ 300.
SELECT pg_temp.expect_num('as partes na Casa somam o valor da despesa',
  (SELECT SUM(es.amount) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000a1'), 300.00);

SELECT pg_temp.expect_num('e a Viagem, sem a despesa, fecha em zero',
  (SELECT SUM(net_balance) FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000001'), 0.00);

SELECT pg_temp.expect_num('a Casa tambem fecha em zero',
  (SELECT SUM(net_balance) FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000000003'), 0.00);

-- =====================================================
-- 4. Sair do grupo, e virar receita
-- =====================================================
UPDATE public.financial_transactions SET group_id = NULL
 WHERE id = '70000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect('tirar do grupo apaga a divisao',
  (SELECT count(*) FROM public.group_transactions
    WHERE transaction_id = '70000000-0000-0000-0000-0000000000a1'), 0);

SELECT pg_temp.expect('e apaga as partes junto (CASCADE)',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000a1'), 0);

-- Volta para a Viagem, agora para provar o outro caminho de saida.
UPDATE public.financial_transactions SET group_id = '99999999-0000-0000-0000-000000000001'
 WHERE id = '70000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect('voltar para o grupo recria a divisao',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000a1'), 3);

-- Despesa que vira receita (valor positivo) nao e mais alguem pagando a conta
-- do grupo: a divisao tem que sair junto, senao o grupo cobra uma entrada de
-- dinheiro como se fosse gasto.
UPDATE public.financial_transactions SET amount = 300.00, transaction_type = 'income'
 WHERE id = '70000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect('virar receita apaga a divisao',
  (SELECT count(*) FROM public.group_transactions
    WHERE transaction_id = '70000000-0000-0000-0000-0000000000a1'), 0);

UPDATE public.financial_transactions SET amount = -300.00, transaction_type = 'expense'
 WHERE id = '70000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect('e voltar a ser despesa recria',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000a1'), 3);

-- A ligacao de grupo que o trigger NAO criaria tambem nao pode ser apagada por
-- uma edicao qualquer. A rota da tela de grupo tem uma rede de seguranca que
-- cria a linha na mao quando o trigger nao agiu -- despesa de valor zero ou
-- positivo, por exemplo --, e nenhum trigger a recriaria depois. Apagar essas
-- linhas a cada edicao de descricao seria trocar um sumico por outro.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT '70000000-0000-0000-0000-0000000000d1',
       'aaaaaaaa-0000-0000-0000-00000000a001',
       'f0000000-0000-0000-0000-0000000000a1',
       c.service_id, c.id, '99999999-0000-0000-0000-000000000001',
       'Reembolso do hotel', 80.00, CURRENT_DATE, 'income'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

INSERT INTO public.group_transactions (group_id, transaction_id, split_type, created_by)
VALUES ('99999999-0000-0000-0000-000000000001',
        '70000000-0000-0000-0000-0000000000d1', 'equal',
        'aaaaaaaa-0000-0000-0000-00000000a001');

UPDATE public.financial_transactions SET description = 'Reembolso (parcial)'
 WHERE id = '70000000-0000-0000-0000-0000000000d1';

SELECT pg_temp.expect('editar a descricao nao apaga ligacao de grupo criada na mao',
  (SELECT count(*) FROM public.group_transactions
    WHERE transaction_id = '70000000-0000-0000-0000-0000000000d1'), 1);

DELETE FROM public.financial_transactions
 WHERE id = '70000000-0000-0000-0000-0000000000d1';

-- =====================================================
-- 5. A opcao (b): parte aprovada trava a edicao
-- =====================================================
-- Caio aprova a parte dele no hotel.
UPDATE public.group_expense_splits es
   SET status = 'approved', approved_at = now()
  FROM public.group_transactions gt, public.group_members gm
 WHERE gt.id = es.group_transaction_id
   AND gt.transaction_id = '70000000-0000-0000-0000-0000000000a1'
   AND gm.id = es.member_id
   AND gm.user_id = 'cccccccc-0000-0000-0000-00000000c001';

SELECT pg_temp.expect('uma parte aprovada',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000a1'
      AND es.status = 'approved'), 1);

DO $$
DECLARE
  v_sqlstate TEXT := NULL;
BEGIN
  BEGIN
    UPDATE public.financial_transactions SET amount = -900.00
     WHERE id = '70000000-0000-0000-0000-0000000000a1';
  EXCEPTION WHEN OTHERS THEN
    v_sqlstate := SQLSTATE;
  END;

  IF v_sqlstate IS DISTINCT FROM 'PDG01' THEN
    RAISE EXCEPTION 'FALHA: mudar o valor com parte aprovada devia falhar com PDG01, veio %',
      COALESCE(v_sqlstate, 'nenhum erro');
  END IF;
  RAISE NOTICE 'ok: mudar o valor com parte aprovada falha com PDG01';
END $$;

-- E o mais importante depois da recusa: nada foi gravado. Nem as partes, nem
-- o valor da transacao -- uma trava que deixa o valor novo e as partes velhas
-- seria o bug original com outra roupa.
SELECT pg_temp.expect_num('o valor da despesa continua -300 depois da recusa',
  (SELECT amount FROM public.financial_transactions
    WHERE id = '70000000-0000-0000-0000-0000000000a1'), -300.00);

SELECT pg_temp.expect_num('e as partes continuam somando 300',
  (SELECT SUM(es.amount) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000a1'), 300.00);

DO $$
DECLARE
  v_sqlstate TEXT := NULL;
BEGIN
  BEGIN
    UPDATE public.financial_transactions SET group_id = '99999999-0000-0000-0000-000000000003'
     WHERE id = '70000000-0000-0000-0000-0000000000a1';
  EXCEPTION WHEN OTHERS THEN
    v_sqlstate := SQLSTATE;
  END;

  IF v_sqlstate IS DISTINCT FROM 'PDG01' THEN
    RAISE EXCEPTION 'FALHA: trocar de grupo com parte aprovada devia falhar com PDG01, veio %',
      COALESCE(v_sqlstate, 'nenhum erro');
  END IF;
  RAISE NOTICE 'ok: trocar de grupo com parte aprovada falha com PDG01';
END $$;

SELECT pg_temp.expect('a despesa continua na Viagem',
  (SELECT count(*) FROM public.group_transactions
    WHERE transaction_id = '70000000-0000-0000-0000-0000000000a1'
      AND group_id = '99999999-0000-0000-0000-000000000001'), 1);

-- Editar SEM mexer em valor nem grupo continua permitido: a trava e sobre o
-- dinheiro, nao sobre a linha.
UPDATE public.financial_transactions SET description = 'Hotel (quarto duplo)'
 WHERE id = '70000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect('trocar a descricao passa mesmo com parte aprovada',
  (SELECT count(*) FROM public.financial_transactions
    WHERE id = '70000000-0000-0000-0000-0000000000a1'
      AND description = 'Hotel (quarto duplo)'), 1);

-- Parte RECUSADA nao trava: ela ja esta fora do saldo, e trava-la deixaria a
-- despesa presa para sempre por decisao de quem se recusou a participar.
UPDATE public.group_expense_splits es
   SET status = 'rejected'
  FROM public.group_transactions gt, public.group_members gm
 WHERE gt.id = es.group_transaction_id
   AND gt.transaction_id = '70000000-0000-0000-0000-0000000000a1'
   AND gm.id = es.member_id
   AND gm.user_id = 'cccccccc-0000-0000-0000-00000000c001';

UPDATE public.financial_transactions SET amount = -600.00
 WHERE id = '70000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect('as duas partes pendentes viraram R$ 200 (600/3)',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000a1'
      AND es.status = 'pending' AND es.amount = 200.00), 2);

SELECT pg_temp.expect_num('e a parte recusada NAO foi recalculada nem ressuscitada',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000a1'
      AND es.status = 'rejected'), 100.00);

-- =====================================================
-- 6. A edicao pela RLS de um membro COMUM
-- =====================================================
-- Bia nao e admin de grupo nenhum. Em SECURITY INVOKER, o recalculo dela
-- apagaria ZERO partes (a policy de DELETE de group_expense_splits exige
-- is_group_admin) e a despesa dela ficaria com as partes velhas -- o bug
-- original, sobrevivendo so para quem nao e admin, e verde num teste rodado
-- como postgres.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT '70000000-0000-0000-0000-0000000000b1',
       'bbbbbbbb-0000-0000-0000-00000000b001',
       'f0000000-0000-0000-0000-0000000000b1',
       c.service_id, c.id, '99999999-0000-0000-0000-000000000001',
       'Gasolina', -90.00, CURRENT_DATE, 'expense'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-00000000b001';

SELECT pg_temp.expect('Bia nao e admin de nenhum grupo',
  (SELECT count(*) FROM public.group_members
    WHERE user_id = 'bbbbbbbb-0000-0000-0000-00000000b001' AND role = 'admin'), 0);

UPDATE public.financial_transactions SET amount = -120.00
 WHERE id = '70000000-0000-0000-0000-0000000000b1';

SELECT pg_temp.expect('Bia, membro comum, refez as 3 partes da gasolina',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000b1'
      AND es.amount = 40.00), 3);

-- E a despesa dela tambem se move sem admin: a policy de DELETE de
-- group_transactions pede created_by = auth.uid() OU admin, e as linhas
-- criadas pelo gemeo (e pela rota antiga) tinham created_by NULL.
UPDATE public.financial_transactions SET group_id = '99999999-0000-0000-0000-000000000003'
 WHERE id = '70000000-0000-0000-0000-0000000000b1';

SELECT pg_temp.expect('a gasolina da Bia ficou em UM grupo so',
  (SELECT count(*) FROM public.group_transactions
    WHERE transaction_id = '70000000-0000-0000-0000-0000000000b1'), 1);

-- A funcao e SECURITY DEFINER e nao e trigger: sem porta fechada, ela seria
-- chamavel pelo PostgREST e reescreveria a divisao de qualquer grupo do banco.
-- Sao DUAS portas, e cada uma fecha um caminho diferente.
--
-- A primeira: `authenticated` nao tem EXECUTE nenhum. Chamar da sessao da Bia
-- para de pe, antes de a funcao rodar uma linha.
DO $$
DECLARE
  v_msg TEXT := NULL;
BEGIN
  BEGIN
    PERFORM public.refazer_rateio_do_grupo('70000000-0000-0000-0000-0000000000a1', NULL, -1);
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLSTATE || ' ' || SQLERRM;
  END;

  IF v_msg IS NULL OR v_msg NOT LIKE '42501 permission denied for function%' THEN
    RAISE EXCEPTION 'FALHA: authenticated devia estar sem EXECUTE na funcao, veio %',
      COALESCE(v_msg, 'nenhum erro');
  END IF;
  RAISE NOTICE 'ok: authenticated nao pode chamar refazer_rateio_do_grupo';
END $$;

RESET ROLE;

-- A segunda: mesmo para quem TEM o EXECUTE (service_role, psql), refazer o
-- rateio de uma despesa alheia e recusado -- aqui com o claim da Bia e a
-- despesa da Ana. Este e o controle que separa "a porta esta fechada" de "a
-- primeira porta escondeu a segunda": as duas recusas tem o mesmo SQLSTATE
-- 42501, e so a mensagem distingue qual delas agiu.
DO $$
DECLARE
  v_msg TEXT := NULL;
BEGIN
  BEGIN
    PERFORM public.refazer_rateio_do_grupo('70000000-0000-0000-0000-0000000000a1', NULL, -1);
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLSTATE || ' ' || SQLERRM;
  END;

  IF v_msg IS DISTINCT FROM '42501 so o dono do lancamento pode refazer o rateio dele' THEN
    RAISE EXCEPTION 'FALHA: refazer o rateio da despesa da Ana com o claim da Bia devia ser recusado, veio %',
      COALESCE(v_msg, 'nenhum erro');
  END IF;
  RAISE NOTICE 'ok: nem com EXECUTE da para refazer rateio de despesa alheia';
END $$;
-- E o claim junto: RESET ROLE devolve o superusuario, mas o `sub` continua
-- valendo ate o fim da transacao, e auth.uid() le o claim, nao o role. Sem
-- limpar, as secoes seguintes seriam a Bia mexendo na despesa da Ana -- e a
-- checagem de dono de refazer_rateio_do_grupo() reprovaria, com razao.
SET LOCAL request.jwt.claim.sub = '';

-- =====================================================
-- 7. Rateio combinado nao vira divisao igual
-- =====================================================
-- A 007 tirou do banco o achatamento de todo rateio para partes iguais. Se o
-- recalculo da edicao refizesse a divisao "do zero", ele traria o defeito de
-- volta pela porta dos fundos: quem combinou 70/30 veria 50/50 depois de
-- corrigir o valor da conta.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT '70000000-0000-0000-0000-0000000000c1',
       'aaaaaaaa-0000-0000-0000-00000000a001',
       'f0000000-0000-0000-0000-0000000000a1',
       c.service_id, c.id, '99999999-0000-0000-0000-000000000003',
       'Internet', -100.00, CURRENT_DATE, 'expense'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

-- E o que a rota de grupo faz com divisao combinada: troca o split_type e
-- substitui as partes.
UPDATE public.group_transactions SET split_type = 'percentage'
 WHERE transaction_id = '70000000-0000-0000-0000-0000000000c1';

DELETE FROM public.group_expense_splits es
 USING public.group_transactions gt
 WHERE gt.id = es.group_transaction_id
   AND gt.transaction_id = '70000000-0000-0000-0000-0000000000c1';

INSERT INTO public.group_expense_splits
  (group_transaction_id, member_id, percentage, amount, status)
SELECT gt.id, gm.id,
       CASE WHEN gm.user_id = 'aaaaaaaa-0000-0000-0000-00000000a001' THEN 70 ELSE 30 END,
       CASE WHEN gm.user_id = 'aaaaaaaa-0000-0000-0000-00000000a001' THEN 70.00 ELSE 30.00 END,
       'pending'
  FROM public.group_transactions gt
  JOIN public.group_members gm ON gm.group_id = gt.group_id AND gm.status = 'active'
 WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000c1';

UPDATE public.financial_transactions SET amount = -200.00
 WHERE id = '70000000-0000-0000-0000-0000000000c1';

SELECT pg_temp.expect_num('a parte de 70% virou R$ 140 (e nao R$ 100)',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
     JOIN public.group_members gm ON gm.id = es.member_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000c1'
      AND gm.user_id = 'aaaaaaaa-0000-0000-0000-00000000a001'), 140.00);

SELECT pg_temp.expect_num('a parte de 30% virou R$ 60',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
     JOIN public.group_members gm ON gm.id = es.member_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000c1'
      AND gm.user_id = 'bbbbbbbb-0000-0000-0000-00000000b001'), 60.00);

SELECT pg_temp.expect('e o split_type continua percentage',
  (SELECT count(*) FROM public.group_transactions
    WHERE transaction_id = '70000000-0000-0000-0000-0000000000c1'
      AND split_type = 'percentage'), 1);

-- E o recorte "so o pendente" vale nos dois caminhos, nao so no igualitario:
-- a Bia recusa os 30% dela, o valor muda de novo, e a parte recusada fica onde
-- estava enquanto a pendente acompanha.
UPDATE public.group_expense_splits es
   SET status = 'rejected'
  FROM public.group_transactions gt, public.group_members gm
 WHERE gt.id = es.group_transaction_id
   AND gt.transaction_id = '70000000-0000-0000-0000-0000000000c1'
   AND gm.id = es.member_id
   AND gm.user_id = 'bbbbbbbb-0000-0000-0000-00000000b001';

UPDATE public.financial_transactions SET amount = -400.00
 WHERE id = '70000000-0000-0000-0000-0000000000c1';

SELECT pg_temp.expect_num('a parte de 70% acompanhou o valor novo (R$ 280)',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
     JOIN public.group_members gm ON gm.id = es.member_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000c1'
      AND gm.user_id = 'aaaaaaaa-0000-0000-0000-00000000a001'), 280.00);

SELECT pg_temp.expect_num('e a parte recusada de 30% continua nos R$ 60 antigos',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = '70000000-0000-0000-0000-0000000000c1'
      AND es.status = 'rejected'), 60.00);

-- =====================================================
-- 8. O indice, e o gemeo que saiu
-- =====================================================
DO $$
DECLARE
  v_recusou BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO public.group_transactions (group_id, transaction_id, split_type, created_by)
    VALUES ('99999999-0000-0000-0000-000000000001',
            '70000000-0000-0000-0000-0000000000c1', 'equal',
            'aaaaaaaa-0000-0000-0000-00000000a001');
  EXCEPTION WHEN unique_violation THEN
    v_recusou := TRUE;
  END;

  IF NOT v_recusou THEN
    RAISE EXCEPTION 'FALHA: a mesma despesa foi aceita em DOIS grupos -- ela pode ser cobrada duas vezes';
  END IF;
  RAISE NOTICE 'ok: a mesma despesa em dois grupos e recusada pelo indice';
END $$;

SELECT pg_temp.expect('o gemeo trigger_sync_transaction_group nao existe mais',
  (SELECT count(*) FROM pg_trigger
    WHERE tgrelid = 'public.financial_transactions'::regclass
      AND NOT tgisinternal
      AND tgname = 'trigger_sync_transaction_group'), 0);

SELECT pg_temp.expect('e sobrou UM trigger de grupo na tabela',
  (SELECT count(*) FROM pg_trigger
    WHERE tgrelid = 'public.financial_transactions'::regclass
      AND NOT tgisinternal
      AND tgname = 'trigger_auto_create_group_transaction'), 1);

SELECT pg_temp.expect('as duas funcoes novas estao em SECURITY DEFINER',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('refazer_rateio_do_grupo', 'recalcular_partes_pendentes')
      AND p.prosecdef
      AND p.proconfig IS NOT NULL), 2);

ROLLBACK;
