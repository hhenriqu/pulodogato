-- =====================================================
-- 078 -- a visao da casa: o mes somado, conta conjunta e dependente
-- =====================================================
-- Roda no db-verify depois da 078 e da segunda aplicacao dela. Tudo numa
-- transacao com ROLLBACK no fim: nao deixa nada para as suites seguintes.
--
-- O ESTADO
--   Ana   admin da Casa, compartilha. Dona da conta "Conjunta" (corrente).
--   Beto  membro da Casa, compartilha.
--   Caio  membro da Casa, NAO compartilha.
--   Duda  de fora.
--   Lia   dependente: membro sem conta (user_id nulo, display_name).
--   A Casa e group_kind 'casa' SEM dia de fechamento: e o caso em que somar o
--   Resultado de cada um conta duas vezes a divida interna (ver a 078).
--
-- O QUE CADA SECAO RESPONDE
--   1. Ninguem aparece antes de ligar o compartilhamento, e o admin nao liga
--      o de outra pessoa.
--   2. O Resultado da casa: cada membro com o numero do painel dele, e o
--      interno que tira a divida de dentro da casa. Controle negativo: sem
--      descontar o interno, a soma passa do que a casa gastou.
--   3. Quem nao e da casa nao le a casa, e evento nao e casa.
--   4. Conta conjunta: as regras de marcar, quem ve, quem lanca, o saldo que
--      anda quando outro membro lanca, e o extrato.
--   5. Saldos e membros (com o dependente).
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

-- O nome pelo id, sem ler `profiles`: o membro da casa nao le o perfil
-- privado do outro (e e por isso que `membros_da_casa` existe).
CREATE OR REPLACE FUNCTION pg_temp.nome(p uuid)
RETURNS TEXT LANGUAGE sql AS $$
  SELECT CASE p
    WHEN 'a0780000-0000-0000-0000-0000000000a1' THEN 'Ana'
    WHEN 'a0780000-0000-0000-0000-0000000000b1' THEN 'Beto'
    WHEN 'a0780000-0000-0000-0000-0000000000c1' THEN 'Caio'
    WHEN 'a0780000-0000-0000-0000-0000000000d1' THEN 'Duda'
  END;
$$;

INSERT INTO auth.users (id, email) VALUES
  ('a0780000-0000-0000-0000-0000000000a1', 'ana@casa078.local'),
  ('a0780000-0000-0000-0000-0000000000b1', 'beto@casa078.local'),
  ('a0780000-0000-0000-0000-0000000000c1', 'caio@casa078.local'),
  ('a0780000-0000-0000-0000-0000000000d1', 'duda@casa078.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a0780000-0000-0000-0000-0000000000a1', 'Ana', FALSE),
  ('a0780000-0000-0000-0000-0000000000b1', 'Beto', FALSE),
  ('a0780000-0000-0000-0000-0000000000c1', 'Caio', FALSE),
  ('a0780000-0000-0000-0000-0000000000d1', 'Duda', FALSE);

-- O trigger do criador poe a Ana (e a Duda no evento) como admin ativa.
INSERT INTO public.expense_groups (id, name, created_by, group_code, group_kind) VALUES
  ('a0780000-0000-0000-0000-0000000000e1', 'Casa', 'a0780000-0000-0000-0000-0000000000a1', 'CASA78', 'casa'),
  ('a0780000-0000-0000-0000-0000000000e2', 'Churrasco', 'a0780000-0000-0000-0000-0000000000a1', 'CHUR78', 'evento');
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('a0780000-0000-0000-0000-0000000000e1', 'a0780000-0000-0000-0000-0000000000b1', 'member', 'active'),
  ('a0780000-0000-0000-0000-0000000000e1', 'a0780000-0000-0000-0000-0000000000c1', 'member', 'active');

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('a0780000-0000-0000-0000-0000000000f1', 'a0780000-0000-0000-0000-0000000000a1', 'Conjunta', 'checking', 1000.00),
  ('a0780000-0000-0000-0000-0000000000f2', 'a0780000-0000-0000-0000-0000000000a1', 'Nubank Ana', 'checking', 500.00),
  ('a0780000-0000-0000-0000-0000000000f3', 'a0780000-0000-0000-0000-0000000000a1', 'Cartao Ana', 'credit_card', 0),
  ('a0780000-0000-0000-0000-0000000000f4', 'a0780000-0000-0000-0000-0000000000b1', 'Conta Beto', 'checking', 300.00),
  ('a0780000-0000-0000-0000-0000000000f5', 'a0780000-0000-0000-0000-0000000000c1', 'Conta Caio', 'checking', 999.00);

-- Outubro. O mercado da Ana e da Casa: o trigger do 024/042 divide entre os
-- tres membros.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0780000-0000-0000-0000-000000000101', 'a0780000-0000-0000-0000-0000000000a1', 'a0780000-0000-0000-0000-0000000000f2',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0780000-0000-0000-0000-0000000000e1', 'Mercado', -90.00, DATE '2026-10-10', 'expense'),
  ('a0780000-0000-0000-0000-000000000102', 'a0780000-0000-0000-0000-0000000000b1', 'a0780000-0000-0000-0000-0000000000f4',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   NULL, 'Salario', 2000.00, DATE '2026-10-05', 'income'),
  ('a0780000-0000-0000-0000-000000000104', 'a0780000-0000-0000-0000-0000000000a1', 'a0780000-0000-0000-0000-0000000000f2',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   NULL, 'Farmacia', -15.00, DATE '2026-10-08', 'expense');

-- A Lia, dependente sem conta. Entra depois do rateio: quem decide se o
-- membro sem conta participa da divisao e a 077.
INSERT INTO public.group_members (group_id, user_id, display_name, role, status) VALUES
  ('a0780000-0000-0000-0000-0000000000e1', NULL, 'Lia', 'member', 'active');

SELECT pg_temp.expect_erro_com('membro sem conta e sem nome e recusado',
  $$INSERT INTO public.group_members (group_id, user_id, display_name, role, status)
    VALUES ('a0780000-0000-0000-0000-0000000000e1', NULL, '  ', 'member', 'active')$$,
  'group_members_quem_e_check');

-- =====================================================
-- SECAO 1: ninguem aparece sem ligar; o admin nao liga o de outro
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0780000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_text('antes de alguem compartilhar, a casa nao tem numero',
  (SELECT count(*)::text FROM public.resultado_da_casa(
     'a0780000-0000-0000-0000-0000000000e1', DATE '2026-10-01', DATE '2026-10-31')), '0');

SELECT pg_temp.expect_erro_com('a admin nao liga o compartilhamento do Caio',
  $$UPDATE public.group_members SET compartilha_com_a_casa = true
     WHERE group_id = 'a0780000-0000-0000-0000-0000000000e1'
       AND user_id = 'a0780000-0000-0000-0000-0000000000c1'$$,
  'so o proprio membro');

SELECT pg_temp.expect_text('a Ana liga o dela',
  public.compartilhar_com_a_casa('a0780000-0000-0000-0000-0000000000e1', true)::text, 'true');

SET LOCAL request.jwt.claim.sub = 'a0780000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_text('o Beto liga o dele',
  public.compartilhar_com_a_casa('a0780000-0000-0000-0000-0000000000e1', true)::text, 'true');

-- O Beto lanca a padaria NA CONTA CONJUNTA da Ana -- depois de ela marcar a
-- conta (SECAO 4). Primeiro a marca:
SET LOCAL request.jwt.claim.sub = 'a0780000-0000-0000-0000-0000000000a1';
UPDATE public.financial_accounts SET casa_id = 'a0780000-0000-0000-0000-0000000000e1'
 WHERE id = 'a0780000-0000-0000-0000-0000000000f1';

SET LOCAL request.jwt.claim.sub = 'a0780000-0000-0000-0000-0000000000b1';
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0780000-0000-0000-0000-000000000103', 'a0780000-0000-0000-0000-0000000000b1', 'a0780000-0000-0000-0000-0000000000f1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'Padaria', -20.00, DATE '2026-10-12', 'expense');

-- =====================================================
-- SECAO 2: o Resultado da casa
-- =====================================================
SET LOCAL request.jwt.claim.sub = 'a0780000-0000-0000-0000-0000000000a1';

CREATE TEMP TABLE r ON COMMIT DROP AS
  SELECT * FROM public.resultado_da_casa(
    'a0780000-0000-0000-0000-0000000000e1', DATE '2026-10-01', DATE '2026-10-31');

SELECT pg_temp.expect_text('so quem compartilha aparece (Ana e Beto, nao o Caio)',
  (SELECT string_agg(pg_temp.nome(r.user_id), ',' ORDER BY pg_temp.nome(r.user_id))
     FROM r), 'Ana,Beto');

-- A Ana: a farmacia e o mercado inteiro, que e o numero do painel dela.
SELECT pg_temp.expect_text('Ana: saiu 105 (farmacia 15 + o mercado inteiro, quem pagou conta inteiro)',
  (SELECT expense::text FROM r WHERE user_id = 'a0780000-0000-0000-0000-0000000000a1'), '105.00');

-- O Beto: o salario, a padaria na conjunta e a parte dele do mercado.
SELECT pg_temp.expect_text('Beto: entrou 2000',
  (SELECT income::text FROM r WHERE user_id = 'a0780000-0000-0000-0000-0000000000b1'), '2000.00');
SELECT pg_temp.expect_text('Beto: saiu 50 (padaria 20 + a parte dele do mercado, 30)',
  (SELECT expense::text FROM r WHERE user_id = 'a0780000-0000-0000-0000-0000000000b1'), '50.00');
SELECT pg_temp.expect_text('Beto: o interno e a parte dele do que a Ana pagou',
  (SELECT interno_expense::text FROM r WHERE user_id = 'a0780000-0000-0000-0000-0000000000b1'), '30.00');
SELECT pg_temp.expect_text('Ana: nada interno (ela pagou)',
  (SELECT interno_expense::text FROM r WHERE user_id = 'a0780000-0000-0000-0000-0000000000a1'), '0.00');

-- A casa: saiu 15 da farmacia + 90 do mercado + 20 da padaria. A parte do Caio no mercado e
-- divida DELE com a Ana; ela continua na soma porque o Caio nao compartilha
-- -- o mercado inteiro saiu do bolso da casa.
SELECT pg_temp.expect_text('a casa gastou 125: soma das saidas menos o interno',
  (SELECT (SUM(expense) - SUM(interno_expense))::text FROM r), '125.00');

-- Controle negativo: somar o Resultado de cada um, sem o interno, da 155 --
-- a parte do Beto contada duas vezes. E o que prova que o interno mede algo.
SELECT pg_temp.expect_text('controle: sem descontar o interno, a soma passa (155)',
  (SELECT SUM(expense)::text FROM r), '155.00');

-- O numero de cada um e o mesmo da view pessoal, a do painel dele.
SET LOCAL request.jwt.claim.sub = 'a0780000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_text('o Beto ve no painel o mesmo 50 que a casa ve',
  (SELECT expense::text FROM public.personal_monthly_cash_flow
    WHERE user_id = auth.uid() AND month = DATE '2026-10-01'), '50.00');

-- =====================================================
-- SECAO 3: quem nao e da casa, e o que nao e casa
-- =====================================================
SET LOCAL request.jwt.claim.sub = 'a0780000-0000-0000-0000-0000000000d1';
SELECT pg_temp.expect_erro_com('a Duda nao le a casa',
  $$SELECT * FROM public.resultado_da_casa('a0780000-0000-0000-0000-0000000000e1', DATE '2026-10-01', DATE '2026-10-31')$$,
  '42501');
SELECT pg_temp.expect_erro_com('a Duda nao le os saldos da casa',
  $$SELECT * FROM public.saldos_da_casa('a0780000-0000-0000-0000-0000000000e1')$$, '42501');
SELECT pg_temp.expect_erro_com('a Duda nao le os membros da casa',
  $$SELECT * FROM public.membros_da_casa('a0780000-0000-0000-0000-0000000000e1')$$, '42501');
SELECT pg_temp.expect_erro_com('a Duda nao liga compartilhamento numa casa que nao e dela',
  $$SELECT public.compartilhar_com_a_casa('a0780000-0000-0000-0000-0000000000e1', true)$$, '42501');

SET LOCAL request.jwt.claim.sub = 'a0780000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_erro_com('evento nao e casa',
  $$SELECT * FROM public.resultado_da_casa('a0780000-0000-0000-0000-0000000000e2', DATE '2026-10-01', DATE '2026-10-31')$$,
  'nao e uma casa');

-- =====================================================
-- SECAO 4: a conta conjunta
-- =====================================================
SELECT pg_temp.expect_text('a padaria do Beto saiu da conjunta da Ana (1000 - 20)',
  (SELECT current_balance::text FROM public.financial_accounts
    WHERE id = 'a0780000-0000-0000-0000-0000000000f1'), '980.00');

SELECT pg_temp.expect_erro_com('cartao nao vira conta conjunta',
  $$UPDATE public.financial_accounts SET casa_id = 'a0780000-0000-0000-0000-0000000000e1'
     WHERE id = 'a0780000-0000-0000-0000-0000000000f3'$$, 'cartao de credito');
SELECT pg_temp.expect_erro_com('evento nao tem conta conjunta',
  $$UPDATE public.financial_accounts SET casa_id = 'a0780000-0000-0000-0000-0000000000e2'
     WHERE id = 'a0780000-0000-0000-0000-0000000000f2'$$, 'tipo casa');

SET LOCAL request.jwt.claim.sub = 'a0780000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_text('o Beto ve a conjunta (e so ela, das contas da Ana)',
  (SELECT string_agg(name, ',') FROM public.financial_accounts
    WHERE user_id = 'a0780000-0000-0000-0000-0000000000a1'), 'Conjunta');
SELECT pg_temp.expect_erro_com('o Beto nao renomeia a conjunta',
  $$UPDATE public.financial_accounts SET name = 'Minha'
     WHERE id = 'a0780000-0000-0000-0000-0000000000f1'$$, 'so o dono');
SELECT pg_temp.expect_text('o Beto nao le o lancamento pessoal da Ana pela tabela',
  (SELECT count(*)::text FROM public.financial_transactions
    WHERE id = 'a0780000-0000-0000-0000-000000000104'), '0');
SELECT pg_temp.expect_text('o extrato da conjunta mostra a padaria, com quem lancou',
  (SELECT string_agg(description || ':' || quem, ',') FROM public.extrato_da_conta_conjunta(
     'a0780000-0000-0000-0000-0000000000f1', DATE '2026-10-01', DATE '2026-10-31')), 'Padaria:Beto');
SELECT pg_temp.expect_erro_com('o Beto nao le extrato de conta que nao e conjunta',
  $$SELECT * FROM public.extrato_da_conta_conjunta('a0780000-0000-0000-0000-0000000000f2', DATE '2026-10-01', DATE '2026-10-31')$$,
  'nao encontrada');

-- O Beto apaga a padaria: o saldo da conjunta volta.
DELETE FROM public.financial_transactions WHERE id = 'a0780000-0000-0000-0000-000000000103';
SELECT pg_temp.expect_text('apagar o lancamento do Beto devolve o saldo da conjunta',
  (SELECT current_balance::text FROM public.financial_accounts
    WHERE id = 'a0780000-0000-0000-0000-0000000000f1'), '1000.00');

SET LOCAL request.jwt.claim.sub = 'a0780000-0000-0000-0000-0000000000d1';
SELECT pg_temp.expect_text('a Duda nao ve a conjunta',
  (SELECT count(*)::text FROM public.financial_accounts
    WHERE id = 'a0780000-0000-0000-0000-0000000000f1'), '0');
SELECT pg_temp.expect_erro_com('a Duda nao lanca na conjunta',
  $$INSERT INTO public.financial_transactions
      (user_id, account_id, service_id, category_id, description, amount, transaction_date, transaction_type)
    VALUES ('a0780000-0000-0000-0000-0000000000d1', 'a0780000-0000-0000-0000-0000000000f1',
            '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8', 'Furto', -5, DATE '2026-10-12', 'expense')$$,
  'so os membros da casa');
SELECT pg_temp.expect_erro_com('a Duda nao le o extrato da conjunta',
  $$SELECT * FROM public.extrato_da_conta_conjunta('a0780000-0000-0000-0000-0000000000f1', DATE '2026-10-01', DATE '2026-10-31')$$,
  'nao encontrada');

-- =====================================================
-- SECAO 5: saldos e membros
-- =====================================================
SET LOCAL request.jwt.claim.sub = 'a0780000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_text('saldos: a conjunta inteira, e o total de quem compartilha (sem cartao, sem o Caio)',
  (SELECT string_agg(tipo || ':' || COALESCE(nome_da_conta, pg_temp.nome(s.user_id)) || ':' || saldo::text, ',' ORDER BY tipo, COALESCE(nome_da_conta, pg_temp.nome(s.user_id)))
     FROM public.saldos_da_casa('a0780000-0000-0000-0000-0000000000e1') s),
  'conjunta:Conjunta:1000.00,pessoal:Ana:395.00,pessoal:Beto:2300.00');

SELECT pg_temp.expect_text('membros: os tres com conta e a Lia como dependente',
  (SELECT string_agg(nome || ':' || dependente::text || ':' || compartilha::text, ',')
     FROM public.membros_da_casa('a0780000-0000-0000-0000-0000000000e1')),
  'Ana:false:true,Beto:false:true,Caio:false:false,Lia:true:false');

-- O Beto desliga: some da casa.
SELECT public.compartilhar_com_a_casa('a0780000-0000-0000-0000-0000000000e1', false);
SELECT pg_temp.expect_text('desligado, o Beto sai da soma',
  (SELECT count(*)::text FROM public.resultado_da_casa(
     'a0780000-0000-0000-0000-0000000000e1', DATE '2026-10-01', DATE '2026-10-31')
    WHERE user_id = 'a0780000-0000-0000-0000-0000000000b1'), '0');

ROLLBACK;
