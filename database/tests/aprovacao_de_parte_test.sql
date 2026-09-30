-- =====================================================
-- Aprovar / recusar a propria parte de despesa de grupo (HMO-178)
-- =====================================================
-- A tela do grupo mostra tres status para cada parte (`pending`, `approved`,
-- `rejected`) desde sempre, mas NENHUM caminho do app escrevia outro valor
-- alem de `pending`: a unica rota de aprovacao que existia mexe em
-- `expense_splits`, que e outra tabela. O cracha era um rotulo morto.
--
-- A HMO-178 acrescenta `PATCH /api/expense-groups/[groupId]/splits`. Esta
-- suite prova o que a rota ASSUME do banco, e que nenhum teste de TypeScript
-- consegue provar:
--
--   1. o dono da parte consegue mesmo escrever `approved` -- a policy de
--      UPDATE do 002 nao e um no-op silencioso. Se fosse, a rota responderia
--      200 e o cracha voltaria a "pendente" no proximo carregamento;
--   2. um membro NAO consegue mexer na parte de outro membro. Esta e a metade
--      que vale dinheiro: recusar tira o valor de `total_owed`, entao aprovar
--      pela pessoa errada seria mexer no saldo alheio;
--   3. recusar MOVE o saldo, e move so o de quem recusou;
--   4. a trava da 024 (HMO-176) deixa de proteger um estado inalcancavel: com
--      uma parte aprovada pelo caminho normal, editar o valor levanta PDG01;
--   5. o CONTROLE HONESTO: pela RLS, o admin do grupo TAMBEM consegue mexer na
--      parte alheia. A rota se restringe ao dono de proposito, e essa
--      restricao mora no TypeScript, nao aqui. Este teste documenta a folga em
--      vez de fingir que ela nao existe -- o dia em que alguem escrever outra
--      rota (ou usar o PostgREST direto), o banco deixa.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 027:
--   psql "$DB_URL" -f database/tests/aprovacao_de_parte_test.sql
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

-- =====================================================
-- Fixture: Ana (admin) paga um hotel de R$ 300, dividido por tres
-- =====================================================
-- Cada um deve 100. O trigger auto_create_group_transaction e quem rateia --
-- o mesmo caminho da HMO-175, entao a fixture nasce do codigo de producao e
-- nao de um INSERT escrito a mao aqui.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000178a1', 'ana@h178.local'),
  ('bbbbbbbb-0000-0000-0000-0000000178b1', 'bia@h178.local'),
  ('cccccccc-0000-0000-0000-0000000178c1', 'caio@h178.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000178a1', 'Ana',  FALSE),
  ('bbbbbbbb-0000-0000-0000-0000000178b1', 'Bia',  FALSE),
  ('cccccccc-0000-0000-0000-0000000178c1', 'Caio', FALSE);

INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('99999999-0000-0000-0000-000000017801', 'Viagem 178',
   'aaaaaaaa-0000-0000-0000-0000000178a1');

-- O trigger add_group_creator ja pos a Ana como admin.
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('99999999-0000-0000-0000-000000017801', 'bbbbbbbb-0000-0000-0000-0000000178b1', 'member', 'active'),
  ('99999999-0000-0000-0000-000000017801', 'cccccccc-0000-0000-0000-0000000178c1', 'member', 'active');

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('f0000000-0000-0000-0000-0000000178a1', 'aaaaaaaa-0000-0000-0000-0000000178a1', 'Conta Ana', 'checking', 1000);

-- Despesa NEGATIVA, como o app grava.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type)
SELECT '70000000-0000-0000-0000-0000000178a1',
       'aaaaaaaa-0000-0000-0000-0000000178a1',
       'f0000000-0000-0000-0000-0000000178a1',
       c.service_id, c.id, '99999999-0000-0000-0000-000000017801',
       'Hotel 178', -300.00, CURRENT_DATE, 'expense'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

SELECT pg_temp.expect('o rateio automatico criou 3 partes',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.group_id = '99999999-0000-0000-0000-000000017801'), 3);

SELECT pg_temp.expect('e as 3 nascem pendentes -- o estado que nunca mudava',
  (SELECT count(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.group_id = '99999999-0000-0000-0000-000000017801'
      AND es.status = 'pending'), 3);

-- Guarda os ids das partes para nao depender de ordem depois.
CREATE TEMP TABLE partes AS
SELECT gm.user_id, es.id AS split_id
  FROM public.group_expense_splits es
  JOIN public.group_members gm ON gm.id = es.member_id
  JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
 WHERE gt.group_id = '99999999-0000-0000-0000-000000017801';

-- A tabela temporaria e do andaime do teste, nao do schema: sem este GRANT as
-- secoes que rodam como `authenticated` morrem em "permission denied for table
-- partes" -- um erro do teste que seria facil confundir com a RLS barrando.
GRANT SELECT ON partes TO authenticated;

-- =====================================================
-- 1. A Bia aprova a PROPRIA parte
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-0000000178b1';

WITH alvo AS (
  SELECT split_id FROM partes WHERE user_id = 'bbbbbbbb-0000-0000-0000-0000000178b1'
), feito AS (
  UPDATE public.group_expense_splits es
     SET status = 'approved', approved_at = now(), updated_at = now()
    FROM alvo
   WHERE es.id = alvo.split_id AND es.status = 'pending'
  RETURNING es.id
)
SELECT pg_temp.expect('a Bia aprova a propria parte (1 linha escrita)',
  (SELECT count(*) FROM feito), 1);

SELECT pg_temp.expect_text('e o status gravado e mesmo "approved"',
  (SELECT es.status FROM public.group_expense_splits es
     JOIN partes p ON p.split_id = es.id
    WHERE p.user_id = 'bbbbbbbb-0000-0000-0000-0000000178b1'), 'approved');

-- =====================================================
-- 2. A Bia NAO mexe na parte do Caio
-- =====================================================
-- A metade que vale dinheiro. A RLS nao levanta erro: ela some com a linha, e
-- o UPDATE "funciona" escrevendo zero. E por isso que a rota confere o numero
-- de linhas devolvidas antes de responder 200.
WITH alvo AS (
  SELECT split_id FROM partes WHERE user_id = 'cccccccc-0000-0000-0000-0000000178c1'
), feito AS (
  UPDATE public.group_expense_splits es
     SET status = 'rejected', updated_at = now()
    FROM alvo
   WHERE es.id = alvo.split_id
  RETURNING es.id
)
SELECT pg_temp.expect('a Bia NAO recusa a parte do Caio (0 linhas)',
  (SELECT count(*) FROM feito), 0);

SELECT pg_temp.expect_text('a parte do Caio continua pendente',
  (SELECT es.status FROM public.group_expense_splits es
     JOIN partes p ON p.split_id = es.id
    WHERE p.user_id = 'cccccccc-0000-0000-0000-0000000178c1'), 'pending');

-- =====================================================
-- 3. Recusar MOVE o saldo, e so o de quem recusou
-- =====================================================
SELECT pg_temp.expect_num('antes de recusar, o Caio deve 100',
  (SELECT total_owed FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000017801'
      AND user_id = 'cccccccc-0000-0000-0000-0000000178c1'), 100.00);

RESET ROLE;
SET LOCAL request.jwt.claim.sub = 'cccccccc-0000-0000-0000-0000000178c1';
SET LOCAL ROLE authenticated;

WITH alvo AS (
  SELECT split_id FROM partes WHERE user_id = 'cccccccc-0000-0000-0000-0000000178c1'
), feito AS (
  UPDATE public.group_expense_splits es
     SET status = 'rejected', approved_at = NULL, updated_at = now()
    FROM alvo
   WHERE es.id = alvo.split_id AND es.status = 'pending'
  RETURNING es.id
)
SELECT pg_temp.expect('o Caio recusa a propria parte (1 linha escrita)',
  (SELECT count(*) FROM feito), 1);

SELECT pg_temp.expect_num('e ai o Caio nao deve mais nada',
  (SELECT total_owed FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000017801'
      AND user_id = 'cccccccc-0000-0000-0000-0000000178c1'), 0.00);

-- A recusa de um nao pode redistribuir a conta nos outros pelas costas deles.
-- Se este numero mudasse, a recusa estaria cobrando de quem nao foi consultado.
SELECT pg_temp.expect_num('e a divida da Bia continua exatamente 100',
  (SELECT total_owed FROM public.group_member_balances
    WHERE group_id = '99999999-0000-0000-0000-000000017801'
      AND user_id = 'bbbbbbbb-0000-0000-0000-0000000178b1'), 100.00);

-- =====================================================
-- 4. A trava da 024 deixa de proteger um estado inalcancavel
-- =====================================================
-- Ate a HMO-178, chegar em `approved` exigia o PostgREST na mao. A parte da
-- Bia foi aprovada na secao 1 pelo caminho que a rota nova usa, e a trava da
-- 024 tem que reagir a ELA.
RESET ROLE;

DO $$
DECLARE
  v_erro TEXT;
BEGIN
  BEGIN
    UPDATE public.financial_transactions
       SET amount = -450.00
     WHERE id = '70000000-0000-0000-0000-0000000178a1';
    RAISE EXCEPTION 'FALHA: editar o valor passou com uma parte aprovada';
  EXCEPTION WHEN sqlstate 'PDG01' THEN
    GET STACKED DIAGNOSTICS v_erro = MESSAGE_TEXT;
    RAISE NOTICE 'ok: a trava da 024 reagiu a aprovacao feita pelo caminho normal (%)', v_erro;
  END;
END $$;

-- O controle POSITIVO da secao 4: sem parte aprovada, a mesma edicao passa.
-- Sem ele, um trigger que recusasse TODA edicao passaria no teste acima.
UPDATE public.group_expense_splits es
   SET status = 'pending', approved_at = NULL
  FROM partes p
 WHERE es.id = p.split_id AND p.user_id = 'bbbbbbbb-0000-0000-0000-0000000178b1';

UPDATE public.financial_transactions
   SET amount = -450.00
 WHERE id = '70000000-0000-0000-0000-0000000178a1';

SELECT pg_temp.expect_num('sem parte aprovada, a mesma edicao passa',
  (SELECT amount FROM public.financial_transactions
    WHERE id = '70000000-0000-0000-0000-0000000178a1'), -450.00);

-- =====================================================
-- 5. Controle honesto: pela RLS o ADMIN tambem alcanca a parte alheia
-- =====================================================
-- A policy group_expense_splits_update do 002 libera
--   owns_group_member(member_id) OR is_group_admin(gt.group_id)
-- A rota da HMO-178 fica no primeiro ramo de proposito: aprovar quer dizer
-- "conferi e concordo que devo isto", e um terceiro concordando no seu lugar
-- esvazia a frase. Esta assercao existe para que a folga fique ESCRITA: ela e
-- do banco, e um `PATCH` futuro que quisesse dar esse poder ao admin nao
-- precisa de migration -- e uma decisao de produto, nao de schema.
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000178a1';
SET LOCAL ROLE authenticated;

WITH alvo AS (
  SELECT split_id FROM partes WHERE user_id = 'cccccccc-0000-0000-0000-0000000178c1'
), feito AS (
  UPDATE public.group_expense_splits es
     SET comments = 'admin passou por aqui', updated_at = now()
    FROM alvo
   WHERE es.id = alvo.split_id
  RETURNING es.id
)
SELECT pg_temp.expect('a Ana (admin) ALCANCA a parte do Caio pela RLS -- a trava e da rota',
  (SELECT count(*) FROM feito), 1);

RESET ROLE;

ROLLBACK;
