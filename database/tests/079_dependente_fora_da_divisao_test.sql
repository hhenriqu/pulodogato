-- =====================================================
-- 079 -- o dependente nao divide despesa e pode morar na casa que fecha
-- =====================================================
-- Roda no db-verify depois da 079 e da segunda aplicacao dela. Tudo num
-- BEGIN com ROLLBACK no fim.
--
-- O ESTADO
--   Ana   admin das duas casas.
--   Beto  membro das duas casas.
--   Lia   dependente: sem conta, fora da divisao.
--   "Casa"        group_kind casa, SEM dia de fechamento.
--   "Casa fecha"  group_kind casa, closing_day 5 (como a de producao).
--
-- O QUE CADA SECAO RESPONDE
--   1. As regras da coluna: so membro sem conta fica fora, e sem peso.
--   2. O rateio igual divide entre quem participa (90 = 45 + 45, nada para a
--      Lia). Controle negativo: o mesmo mercado com a Lia participando da 30.
--   3. A parte com valor para o dependente e recusada; tirar da divisao quem ja
--      tem parte e recusado; so o admin muda.
--   4. A casa que fecha aceita o dependente e continua recusando (PDG77) o
--      membro sem conta que divide -- inclusive o dependente que volta a
--      dividir. Ligar o dia de fechamento com so dependente sem conta passa.
--   5. A despesa paga por outro membro (077) tambem pula o dependente.
--   6. membros_da_casa continua mostrando a Lia como dependente.
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

-- As partes de uma despesa, como texto ordenado: "Ana:45.00,Beto:45.00".
CREATE OR REPLACE FUNCTION pg_temp.partes(p_ft uuid)
RETURNS TEXT LANGUAGE sql AS $$
  SELECT string_agg(COALESCE(p.full_name, gm.display_name) || ':' || es.amount::text, ','
                    ORDER BY COALESCE(p.full_name, gm.display_name))
    FROM public.group_expense_splits es
    JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    JOIN public.group_members gm ON gm.id = es.member_id
    LEFT JOIN public.profiles p ON p.id = gm.user_id
   WHERE gt.transaction_id = p_ft;
$$;

INSERT INTO auth.users (id, email) VALUES
  ('a0790000-0000-0000-0000-0000000000a1', 'ana@dep079.local'),
  ('a0790000-0000-0000-0000-0000000000b1', 'beto@dep079.local');
INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a0790000-0000-0000-0000-0000000000a1', 'Ana', FALSE),
  ('a0790000-0000-0000-0000-0000000000b1', 'Beto', FALSE);

INSERT INTO public.expense_groups (id, name, created_by, group_code, group_kind, closing_day) VALUES
  ('a0790000-0000-0000-0000-0000000000e1', 'Casa', 'a0790000-0000-0000-0000-0000000000a1', 'DEP791', 'casa', NULL),
  ('a0790000-0000-0000-0000-0000000000e2', 'Casa fecha', 'a0790000-0000-0000-0000-0000000000a1', 'DEP792', 'casa', 5);
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('a0790000-0000-0000-0000-0000000000e1', 'a0790000-0000-0000-0000-0000000000b1', 'member', 'active'),
  ('a0790000-0000-0000-0000-0000000000e2', 'a0790000-0000-0000-0000-0000000000b1', 'member', 'active');

-- A Lia nas duas casas, fora da divisao.
INSERT INTO public.group_members (id, group_id, user_id, display_name, role, status, participa_da_divisao) VALUES
  ('a0790000-0000-0000-0000-0000000000c1', 'a0790000-0000-0000-0000-0000000000e1', NULL, 'Lia', 'member', 'active', false),
  ('a0790000-0000-0000-0000-0000000000c2', 'a0790000-0000-0000-0000-0000000000e2', NULL, 'Lia', 'member', 'active', false);

-- =====================================================
-- SECAO 1: as regras da coluna
-- =====================================================
SELECT pg_temp.expect_text('membro novo participa da divisao por padrao',
  (SELECT participa_da_divisao::text FROM public.group_members
    WHERE group_id = 'a0790000-0000-0000-0000-0000000000e1'
      AND user_id = 'a0790000-0000-0000-0000-0000000000b1'), 'true');

SELECT pg_temp.expect_erro_com('quem tem conta nao fica fora da divisao',
  $$UPDATE public.group_members SET participa_da_divisao = false
     WHERE group_id = 'a0790000-0000-0000-0000-0000000000e1'
       AND user_id = 'a0790000-0000-0000-0000-0000000000b1'$$,
  'group_members_fora_da_divisao_sem_conta_check');

SELECT pg_temp.expect_erro_com('dependente nao tem peso na divisao',
  $$UPDATE public.group_members SET percentage = 10
     WHERE id = 'a0790000-0000-0000-0000-0000000000c1'$$,
  'group_members_fora_da_divisao_sem_peso_check');

-- =====================================================
-- SECAO 2: o rateio igual divide entre quem participa
-- =====================================================
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, group_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0790000-0000-0000-0000-000000000101', 'a0790000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0790000-0000-0000-0000-0000000000e1', 'Mercado', -90.00, DATE '2026-10-10', 'expense');

SELECT pg_temp.expect_text('o mercado de 90 e 45 + 45, e a Lia nao recebe parte',
  pg_temp.partes('a0790000-0000-0000-0000-000000000101'), 'Ana:45.00,Beto:45.00');

-- Controle negativo: a Lia participando, o mesmo mercado da 30 para cada um.
-- E o que prova que a secao acima mede o filtro, e nao um rateio que nunca
-- contou o membro sem conta.
UPDATE public.group_members SET participa_da_divisao = true
 WHERE id = 'a0790000-0000-0000-0000-0000000000c1';
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, group_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0790000-0000-0000-0000-000000000102', 'a0790000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0790000-0000-0000-0000-0000000000e1', 'Mercado 2', -90.00, DATE '2026-10-11', 'expense');
SELECT pg_temp.expect_text('controle: participando, a Lia fica com 30',
  pg_temp.partes('a0790000-0000-0000-0000-000000000102'), 'Ana:30.00,Beto:30.00,Lia:30.00');

-- =====================================================
-- SECAO 3: parte com valor, tirar quem ja tem parte, e quem muda
-- =====================================================
SELECT pg_temp.expect_erro_com('nao tira da divisao quem ja tem parte em despesa',
  $$UPDATE public.group_members SET participa_da_divisao = false
     WHERE id = 'a0790000-0000-0000-0000-0000000000c1'$$,
  'ja tem parte');

-- Apaga o mercado 2 (e as partes dele) e devolve a Lia para fora.
DELETE FROM public.financial_transactions WHERE id = 'a0790000-0000-0000-0000-000000000102';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0790000-0000-0000-0000-0000000000b1';
-- O Beto (nao admin) nao alcanca a linha da Lia pelo RLS: o UPDATE passa sem
-- mudar nada. (O trigger da 079 e a segunda trava, para quem escreve por uma
-- funcao DEFINER.)
UPDATE public.group_members SET participa_da_divisao = false
 WHERE id = 'a0790000-0000-0000-0000-0000000000c1';
RESET ROLE;
SELECT pg_temp.expect_text('o Beto (nao admin) nao muda quem participa',
  (SELECT participa_da_divisao::text FROM public.group_members
    WHERE id = 'a0790000-0000-0000-0000-0000000000c1'), 'true');
-- A trava do trigger, direto: com o Beto como auth.uid() e sem RLS no caminho.
SET LOCAL request.jwt.claim.sub = 'a0790000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_erro_com('o trigger recusa quem nao e admin',
  $$UPDATE public.group_members SET participa_da_divisao = false
     WHERE id = 'a0790000-0000-0000-0000-0000000000c1'$$,
  '42501');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0790000-0000-0000-0000-0000000000a1';
UPDATE public.group_members SET participa_da_divisao = false
 WHERE id = 'a0790000-0000-0000-0000-0000000000c1';
SELECT pg_temp.expect_text('a Ana (admin) tira a Lia da divisao',
  (SELECT participa_da_divisao::text FROM public.group_members
    WHERE id = 'a0790000-0000-0000-0000-0000000000c1'), 'false');
RESET ROLE;

SELECT pg_temp.expect_erro_com('parte com valor para o dependente e recusada',
  $$INSERT INTO public.group_expense_splits (group_transaction_id, member_id, percentage, amount, status)
    SELECT gt.id, 'a0790000-0000-0000-0000-0000000000c1', 10, 9.00, 'pending'
      FROM public.group_transactions gt
     WHERE gt.transaction_id = 'a0790000-0000-0000-0000-000000000101'$$,
  'dependente nao divide');

-- =====================================================
-- SECAO 4: a casa que fecha
-- =====================================================
SELECT pg_temp.expect_text('a casa que fecha aceitou a Lia como dependente',
  (SELECT count(*)::text FROM public.group_members
    WHERE id = 'a0790000-0000-0000-0000-0000000000c2' AND status = 'active'), '1');

SELECT pg_temp.expect_erro_com('a casa que fecha continua recusando sem conta que divide',
  $$INSERT INTO public.group_members (group_id, user_id, display_name, role, status)
    VALUES ('a0790000-0000-0000-0000-0000000000e2', NULL, 'Amigo', 'member', 'active')$$,
  'PDG77');

SELECT pg_temp.expect_erro_com('e recusa o dependente que volta a dividir',
  $$UPDATE public.group_members SET participa_da_divisao = true
     WHERE id = 'a0790000-0000-0000-0000-0000000000c2'$$,
  'PDG77');

-- O mercado na casa que fecha: as partes nascem so para quem participa.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, group_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0790000-0000-0000-0000-000000000103', 'a0790000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0790000-0000-0000-0000-0000000000e2', 'Aluguel', -1500.00, DATE '2026-10-12', 'expense');
SELECT pg_temp.expect_text('na casa que fecha, a Lia tambem nao recebe parte',
  pg_temp.partes('a0790000-0000-0000-0000-000000000103'), 'Ana:750.00,Beto:750.00');

-- Ligar o dia de fechamento numa casa que so tem dependente sem conta passa.
UPDATE public.expense_groups SET closing_day = 10
 WHERE id = 'a0790000-0000-0000-0000-0000000000e1';
SELECT pg_temp.expect_text('a Casa passou a fechar com a Lia dentro',
  (SELECT closing_day::text FROM public.expense_groups
    WHERE id = 'a0790000-0000-0000-0000-0000000000e1'), '10');
UPDATE public.expense_groups SET closing_day = NULL
 WHERE id = 'a0790000-0000-0000-0000-0000000000e1';

-- =====================================================
-- SECAO 5: a despesa paga por outro membro (077) pula o dependente
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0790000-0000-0000-0000-0000000000a1';
CREATE TEMP TABLE gt_paga ON COMMIT DROP AS
  SELECT public.lancar_despesa_paga_por_membro(
    'a0790000-0000-0000-0000-0000000000e1',
    (SELECT id FROM public.group_members
      WHERE group_id = 'a0790000-0000-0000-0000-0000000000e1'
        AND user_id = 'a0790000-0000-0000-0000-0000000000b1'),
    60, 'Gas', DATE '2026-10-15') AS id;
RESET ROLE;
SELECT pg_temp.expect_text('o gas de 60 pago pelo Beto: 30 + 30, sem a Lia',
  (SELECT string_agg(COALESCE(p.full_name, gm.display_name) || ':' || es.amount::text, ','
                     ORDER BY COALESCE(p.full_name, gm.display_name))
     FROM public.group_expense_splits es
     JOIN public.group_members gm ON gm.id = es.member_id
     LEFT JOIN public.profiles p ON p.id = gm.user_id
    WHERE es.group_transaction_id = (SELECT id FROM gt_paga)),
  'Ana:30.00,Beto:30.00');

-- =====================================================
-- SECAO 6: membros_da_casa
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0790000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_text('a Lia aparece como dependente na casa',
  (SELECT string_agg(nome || ':' || dependente::text, ',')
     FROM public.membros_da_casa('a0790000-0000-0000-0000-0000000000e2')),
  'Ana:false,Beto:false,Lia:true');

ROLLBACK;
