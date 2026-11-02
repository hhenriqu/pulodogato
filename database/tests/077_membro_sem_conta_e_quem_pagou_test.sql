-- =====================================================
-- 077 -- o membro sem conta e a despesa paga por outra pessoa
-- =====================================================
-- Roda no db-verify depois da 077 e da segunda aplicacao dela.
--
-- A historia: o Helio (admin) organiza um churrasco com a Lais (com conta) e
-- o Joao (sem conta). O Helio paga R$ 90 de carne na conta dele; o Joao pagou
-- R$ 60 de carvao e o Helio registra por ele.
--
-- O QUE CADA SECAO RESPONDE
--   1. O membro sem conta: so o admin adiciona, precisa de nome, nao e admin.
--   2. Ele divide a despesa lancada (o trigger do rateio o inclui).
--   3. A despesa paga por outro: a funcao divide; INSERT direto e recusado;
--      valor nao muda por UPDATE; nao cria lancamento em conta nenhuma.
--   4. O saldo do grupo casa pelo MEMBRO: o Joao tem saldo, e a soma e zero.
--      Controle negativo: casando por user_id, como na 026, o Joao ficaria
--      com zero e a soma nao fecharia.
--   5. O acerto com quem nao tem conta: quem tem conta registra; o admin
--      registra entre dois sem conta; ninguem mais registra por eles. O
--      trigger completa member_id a partir do user_id (acerto do jeito antigo).
--   6. A trava do fechamento (PDG77) nas tres portas.
--   7. bill_alerts nao gera aviso com destinatario nulo.
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect_text(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_erro_com(label TEXT, sql TEXT, trecho TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(trecho IN SQLSTATE || ' ' || SQLERRM) = 0 THEN
      RAISE EXCEPTION 'FALHA: % -> barrado, mas por outro motivo: % %', label, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'ok: % (barrado: %)', label, left(SQLERRM, 80);
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o comando PASSOU e deveria ter sido barrado', label;
END $$;

-- O saldo de cada um como texto estavel: "nome:saldo" em ordem de nome.
CREATE OR REPLACE FUNCTION pg_temp.saldos(p_group uuid)
RETURNS TEXT LANGUAGE sql AS $$
  -- O nome pelo id, e nao por `profiles`: a RLS esconde o perfil privado do
  -- outro membro, e a suite mede o saldo, nao a visibilidade do perfil.
  SELECT string_agg(x.nome || ':' || x.net_balance::text, ' ' ORDER BY x.nome)
    FROM (
      SELECT COALESCE(b.display_name,
               CASE b.user_id
                 WHEN 'a0770000-0000-0000-0000-0000000000a1' THEN 'Helio'
                 WHEN 'a0770000-0000-0000-0000-0000000000b1' THEN 'Lais'
               END) AS nome,
             b.net_balance
        FROM public.group_member_balances b
       WHERE b.group_id = p_group
    ) x;
$$;

-- =====================================================
-- Fixture
-- =====================================================
--   Helio a1 (cria o grupo, vira admin pelo trigger), Lais b1
--   conta corrente do Helio c1; grupo Churrasco d1 (sem fechamento)
--   Moradia  b61d7949-2abc-430d-9bd0-02a146c1d9d8  (despesa, do seed)
--   servico  8730cd96-d656-4c48-863e-673e1016a832  (personal_finance)
INSERT INTO auth.users (id, email) VALUES
  ('a0770000-0000-0000-0000-0000000000a1', 'helio@churrasco.local'),
  ('a0770000-0000-0000-0000-0000000000b1', 'lais@churrasco.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a0770000-0000-0000-0000-0000000000a1', 'Helio', FALSE),
  ('a0770000-0000-0000-0000-0000000000b1', 'Lais', FALSE);

INSERT INTO public.financial_accounts (id, user_id, name, account_type) VALUES
  ('a0770000-0000-0000-0000-0000000000c1', 'a0770000-0000-0000-0000-0000000000a1', 'Corrente do Helio', 'checking');

INSERT INTO public.expense_groups (id, name, created_by, group_code) VALUES
  ('a0770000-0000-0000-0000-0000000000d1', 'Churrasco', 'a0770000-0000-0000-0000-0000000000a1', 'CHUR77');
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('a0770000-0000-0000-0000-0000000000d1', 'a0770000-0000-0000-0000-0000000000b1', 'member', 'active');

-- =====================================================
-- SECAO 1: o membro sem conta
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0770000-0000-0000-0000-0000000000a1';

INSERT INTO public.group_members (id, group_id, user_id, display_name, role, status)
VALUES ('a0770000-0000-0000-0000-0000000000e1', 'a0770000-0000-0000-0000-0000000000d1',
        NULL, 'Joao', 'member', 'active');

SELECT pg_temp.expect_text('o admin adiciona o Joao sem conta',
  (SELECT display_name FROM public.group_members
    WHERE id = 'a0770000-0000-0000-0000-0000000000e1'), 'Joao');

SELECT pg_temp.expect_erro_com('membro sem conta precisa de nome',
  $$INSERT INTO public.group_members (group_id, user_id, display_name, role, status)
    VALUES ('a0770000-0000-0000-0000-0000000000d1', NULL, '   ', 'member', 'active')$$,
  'group_members_quem_e_check');

SELECT pg_temp.expect_erro_com('membro sem conta nao e admin',
  $$INSERT INTO public.group_members (group_id, user_id, display_name, role, status)
    VALUES ('a0770000-0000-0000-0000-0000000000d1', NULL, 'Pedro', 'admin', 'active')$$,
  'group_members_sem_conta_nao_e_admin_check');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0770000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_erro_com('quem nao e admin nao adiciona membro sem conta',
  $$INSERT INTO public.group_members (group_id, user_id, display_name, role, status)
    VALUES ('a0770000-0000-0000-0000-0000000000d1', NULL, 'Pedro', 'member', 'active')$$,
  'row-level security');
SELECT pg_temp.expect_text('a Lais ve o Joao na lista do grupo',
  (SELECT count(*)::text FROM public.group_members
    WHERE group_id = 'a0770000-0000-0000-0000-0000000000d1' AND user_id IS NULL), '1');
RESET ROLE;

-- =====================================================
-- SECAO 2: ele divide a despesa lancada
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0770000-0000-0000-0000-0000000000a1';
INSERT INTO public.financial_transactions
  (id, user_id, service_id, account_id, category_id, description, amount,
   transaction_date, transaction_type, group_id)
VALUES ('a0770000-0000-0000-0000-000000000011', 'a0770000-0000-0000-0000-0000000000a1',
        '8730cd96-d656-4c48-863e-673e1016a832', 'a0770000-0000-0000-0000-0000000000c1',
        'b61d7949-2abc-430d-9bd0-02a146c1d9d8', 'Carne', -90.00, DATE '2026-11-01',
        'expense', 'a0770000-0000-0000-0000-0000000000d1');

SELECT pg_temp.expect_text('a carne divide em tres, o Joao incluso',
  (SELECT string_agg(es.amount::text, '/' ORDER BY es.amount)
     FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = 'a0770000-0000-0000-0000-000000000011'),
  '30.00/30.00/30.00');
SELECT pg_temp.expect_text('a parte do Joao e dele, pelo member_id',
  (SELECT es.amount::text
     FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.transaction_id = 'a0770000-0000-0000-0000-000000000011'
      AND es.member_id = 'a0770000-0000-0000-0000-0000000000e1'), '30.00');

-- =====================================================
-- SECAO 3: a despesa paga por outro
-- =====================================================
SELECT pg_temp.expect_text('o Helio registra o carvao que o Joao pagou',
  (SELECT (public.lancar_despesa_paga_por_membro(
      'a0770000-0000-0000-0000-0000000000d1',
      'a0770000-0000-0000-0000-0000000000e1',
      60, 'Carvao', DATE '2026-11-01')) IS NOT NULL)::text, 'true');

SELECT pg_temp.expect_text('o carvao divide em tres, por cima do valor da propria linha',
  (SELECT string_agg(es.amount::text, '/' ORDER BY es.amount)
     FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.group_id = 'a0770000-0000-0000-0000-0000000000d1'
      AND gt.transaction_id IS NULL),
  '20.00/20.00/20.00');

SELECT pg_temp.expect_text('o carvao nao virou lancamento de ninguem',
  (SELECT count(*)::text FROM public.financial_transactions
    WHERE description = 'Carvao'), '0');

SELECT pg_temp.expect_text('a conta do Helio so tem a carne',
  (SELECT current_balance::text FROM public.financial_accounts
    WHERE id = 'a0770000-0000-0000-0000-0000000000c1'), '-90.00');

SELECT pg_temp.expect_erro_com('INSERT direto de despesa so do grupo e recusado',
  $$INSERT INTO public.group_transactions
      (group_id, split_type, created_by, paid_by_member_id, amount, description,
       expense_date, currency, exchange_rate)
    VALUES ('a0770000-0000-0000-0000-0000000000d1', 'equal',
            'a0770000-0000-0000-0000-0000000000a1',
            'a0770000-0000-0000-0000-0000000000e1', 500, 'Golpe',
            DATE '2026-11-01', 'BRL', 1)$$,
  'row-level security');

SELECT pg_temp.expect_erro_com('o valor da despesa so do grupo nao muda por UPDATE',
  $$UPDATE public.group_transactions SET amount = 600
     WHERE group_id = 'a0770000-0000-0000-0000-0000000000d1' AND transaction_id IS NULL$$,
  'PDG77');

UPDATE public.group_transactions SET description = 'Carvao e gelo'
 WHERE group_id = 'a0770000-0000-0000-0000-0000000000d1' AND transaction_id IS NULL;
SELECT pg_temp.expect_text('a descricao muda',
  (SELECT description FROM public.group_transactions
    WHERE group_id = 'a0770000-0000-0000-0000-0000000000d1' AND transaction_id IS NULL),
  'Carvao e gelo');

SELECT pg_temp.expect_erro_com('quem pagou tem que ser do grupo',
  $$SELECT public.lancar_despesa_paga_por_membro(
      'a0770000-0000-0000-0000-0000000000d1',
      'a0770000-0000-0000-0000-0000000000ff', 10, 'X')$$,
  'participante ativo');

SELECT pg_temp.expect_erro_com('moeda estrangeira sem cotacao e recusada',
  $$SELECT public.lancar_despesa_paga_por_membro(
      'a0770000-0000-0000-0000-0000000000d1',
      'a0770000-0000-0000-0000-0000000000e1', 10, 'X', CURRENT_DATE, 'USD', 1)$$,
  'cotacao');
RESET ROLE;

-- Quem nao e do grupo nao lanca.
INSERT INTO auth.users (id, email) VALUES
  ('a0770000-0000-0000-0000-0000000000f1', 'intruso@churrasco.local');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0770000-0000-0000-0000-0000000000f1';
SELECT pg_temp.expect_erro_com('quem nao e do grupo nao lanca despesa paga por outro',
  $$SELECT public.lancar_despesa_paga_por_membro(
      'a0770000-0000-0000-0000-0000000000d1',
      'a0770000-0000-0000-0000-0000000000e1', 10, 'X')$$,
  '42501');
RESET ROLE;

-- =====================================================
-- SECAO 4: o saldo do grupo pelo membro
-- =====================================================
-- Helio pagou 90, deve 50 -> +40. Lais deve 50 -> -50. Joao pagou 60, deve 50 -> +10.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0770000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_text('o saldo de cada um, visto pela Lais',
  pg_temp.saldos('a0770000-0000-0000-0000-0000000000d1'),
  'Helio:40.00 Joao:10.00 Lais:-50.00');
SELECT pg_temp.expect_text('o saldo do grupo fecha em zero',
  (SELECT SUM(net_balance)::text FROM public.group_member_balances
    WHERE group_id = 'a0770000-0000-0000-0000-0000000000d1'), '0.00');
SELECT pg_temp.expect_text('o Joao aparece com o nome e sem user_id',
  (SELECT display_name || '/' || COALESCE(user_id::text, 'sem conta')
     FROM public.group_member_balances
    WHERE member_id = 'a0770000-0000-0000-0000-0000000000e1'), 'Joao/sem conta');
RESET ROLE;

-- Controle negativo: a regra da 026 (pago e devido casados por user_id) deixa
-- o Joao em zero e a soma do grupo em -10 -- o defeito que a SECAO 8 conserta.
SELECT pg_temp.expect_text('controle negativo: casando por user_id o Joao some do saldo',
  (SELECT (COALESCE(SUM(es.amount), 0))::text
     FROM public.group_expense_splits es
     JOIN public.group_members em ON em.id = es.member_id
     JOIN public.group_members m ON m.id = 'a0770000-0000-0000-0000-0000000000e1'
    WHERE em.user_id = m.user_id), '0');

-- =====================================================
-- SECAO 5: o acerto com quem nao tem conta
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0770000-0000-0000-0000-0000000000b1';
-- A Lais paga R$ 10 ao Joao (ela tem conta, entao ela registra).
INSERT INTO public.group_settlements
  (group_id, from_user_id, to_member_id, amount, created_by)
VALUES ('a0770000-0000-0000-0000-0000000000d1', 'a0770000-0000-0000-0000-0000000000b1',
        'a0770000-0000-0000-0000-0000000000e1', 10, 'a0770000-0000-0000-0000-0000000000b1');
SELECT pg_temp.expect_text('o trigger completa a linha da Lais e deixa o Joao sem user_id',
  (SELECT (from_member_id IS NOT NULL)::text || '/' || COALESCE(to_user_id::text, 'nulo')
     FROM public.group_settlements
    WHERE group_id = 'a0770000-0000-0000-0000-0000000000d1'), 'true/nulo');
SELECT pg_temp.expect_text('o acerto zera o Joao e abate a Lais',
  pg_temp.saldos('a0770000-0000-0000-0000-0000000000d1'),
  'Helio:40.00 Joao:0.00 Lais:-40.00');

SELECT pg_temp.expect_erro_com('a Lais nao registra acerto entre o Helio e o Joao',
  $$INSERT INTO public.group_settlements (group_id, from_member_id, to_user_id, amount, created_by)
    VALUES ('a0770000-0000-0000-0000-0000000000d1', 'a0770000-0000-0000-0000-0000000000e1',
            'a0770000-0000-0000-0000-0000000000a1', 5, 'a0770000-0000-0000-0000-0000000000b1')$$,
  'row-level security');
RESET ROLE;

-- Um segundo convidado, para o acerto entre dois sem conta.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0770000-0000-0000-0000-0000000000a1';
INSERT INTO public.group_members (id, group_id, user_id, display_name, role, status)
VALUES ('a0770000-0000-0000-0000-0000000000e2', 'a0770000-0000-0000-0000-0000000000d1',
        NULL, 'Pedro', 'member', 'active');
SAVEPOINT entre_convidados;
INSERT INTO public.group_settlements (group_id, from_member_id, to_member_id, amount, created_by)
VALUES ('a0770000-0000-0000-0000-0000000000d1', 'a0770000-0000-0000-0000-0000000000e2',
        'a0770000-0000-0000-0000-0000000000e1', 5, 'a0770000-0000-0000-0000-0000000000a1');
SELECT pg_temp.expect_text('o admin registra o Pedro pagando o Joao',
  (SELECT count(*)::text FROM public.group_settlements
    WHERE from_member_id = 'a0770000-0000-0000-0000-0000000000e2'), '1');
ROLLBACK TO SAVEPOINT entre_convidados;

-- O acerto do jeito antigo (so user_id) ganha os member_id pelo trigger.
SAVEPOINT jeito_antigo;
INSERT INTO public.group_settlements (group_id, from_user_id, to_user_id, amount, created_by)
VALUES ('a0770000-0000-0000-0000-0000000000d1', 'a0770000-0000-0000-0000-0000000000a1',
        'a0770000-0000-0000-0000-0000000000b1', 1, 'a0770000-0000-0000-0000-0000000000a1');
SELECT pg_temp.expect_text('acerto por user_id ganha os dois member_id',
  (SELECT (from_member_id IS NOT NULL AND to_member_id IS NOT NULL)::text
     FROM public.group_settlements
    WHERE from_user_id = 'a0770000-0000-0000-0000-0000000000a1'
      AND to_user_id = 'a0770000-0000-0000-0000-0000000000b1'), 'true');
ROLLBACK TO SAVEPOINT jeito_antigo;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0770000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_erro_com('quem nao e admin nao registra acerto entre dois sem conta',
  $$INSERT INTO public.group_settlements (group_id, from_member_id, to_member_id, amount, created_by)
    VALUES ('a0770000-0000-0000-0000-0000000000d1', 'a0770000-0000-0000-0000-0000000000e2',
            'a0770000-0000-0000-0000-0000000000e1', 5, 'a0770000-0000-0000-0000-0000000000b1')$$,
  'row-level security');
RESET ROLE;

-- =====================================================
-- SECAO 6: a trava do fechamento
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0770000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_erro_com('nao liga o fechamento com membro sem conta no grupo',
  $$UPDATE public.expense_groups SET closing_day = 10
     WHERE id = 'a0770000-0000-0000-0000-0000000000d1'$$,
  'PDG77');

INSERT INTO public.expense_groups (id, name, created_by, group_code, closing_day) VALUES
  ('a0770000-0000-0000-0000-0000000000d2', 'Casa', 'a0770000-0000-0000-0000-0000000000a1', 'CASA77', 5);
SELECT pg_temp.expect_erro_com('grupo que fecha nao recebe membro sem conta',
  $$INSERT INTO public.group_members (group_id, user_id, display_name, role, status)
    VALUES ('a0770000-0000-0000-0000-0000000000d2', NULL, 'Filho', 'member', 'active')$$,
  'PDG77');
SELECT pg_temp.expect_erro_com('grupo que fecha nao recebe despesa paga por outro',
  $$SELECT public.lancar_despesa_paga_por_membro(
      'a0770000-0000-0000-0000-0000000000d2',
      (SELECT id FROM public.group_members
        WHERE group_id = 'a0770000-0000-0000-0000-0000000000d2' LIMIT 1),
      10, 'Mercado')$$,
  'PDG77');
RESET ROLE;

-- =====================================================
-- SECAO 7: bill_alerts nao avisa quem nao tem conta
-- =====================================================
INSERT INTO public.scheduled_transactions
  (user_id, category_id, account_id, description, amount, due_date, transaction_type, group_id)
VALUES ('a0770000-0000-0000-0000-0000000000a1', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
        'a0770000-0000-0000-0000-0000000000c1', 'Aluguel da chacara', 300,
        CURRENT_DATE + 1, 'expense', 'a0770000-0000-0000-0000-0000000000d1');
SELECT pg_temp.expect_text('o aviso da conta do grupo vai para quem tem conta, e so',
  (SELECT count(*)::text || '/' || count(user_id)::text FROM public.bill_alerts
    WHERE group_id = 'a0770000-0000-0000-0000-0000000000d1'), '2/2');

ROLLBACK;
