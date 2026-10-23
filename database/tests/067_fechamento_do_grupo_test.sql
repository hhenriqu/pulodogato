-- =====================================================
-- Teste do fechamento do grupo por periodo (067)
-- =====================================================
-- O exemplo da RN018, em miniatura: grupo Casa, 50/30/20, periodo de 10/10 a
-- 09/11/2026, R$ 2.000 de contas (Helio pagou 1.500, Lais 500, Leticia nada).
-- O fechamento tem de gerar:
--
--   Helio    A receber do grupo   R$ 500
--   Lais     Pagamento ao grupo   R$ 100
--   Leticia  Pagamento ao grupo   R$ 400
--
-- Prova:
--
--   1. `closing_day` aceita 1..28 e NULL, e recusa 0 e 29;
--   2. o fechamento grava os itens e as tres contas, vencendo no fim do
--      periodo, sem `group_id` e com as categorias reservadas;
--   3. o mesmo periodo de novo devolve NULL e nao grava nada (o cron
--      re-executavel);
--   4. a mesma despesa em dois fechamentos e recusada, e o segundo fechamento
--      inteiro volta atras;
--   5. o banco recusa as somas erradas: total, saldo, contas que nao sao os
--      saldos, item de outro grupo, item depois do fim do periodo;
--   6. o segundo periodo pega a despesa lancada com data do periodo ja
--      fechado e o acerto antigo (RN018.3, RN018.11);
--   7. so service_role executa a funcao; membro le, quem nao e membro nao le,
--      e ninguem do app escreve nas tabelas;
--   8. a trava: o dono da conta gerada nao muda o valor nem o elo, nao cria
--      conta com elo, e a baixa continua livre;
--   9. apagar o fechamento solta o elo das contas (o ON DELETE SET NULL passa
--      pela trava).
--
-- Rodar num banco limpo, depois de 001 -> ... -> 067:
--   psql "$DB_URL" -f database/tests/067_fechamento_do_grupo_test.sql
--
-- Qualquer FALHA lanca excecao e aborta. Tudo roda numa transacao com ROLLBACK.
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

CREATE OR REPLACE FUNCTION pg_temp.expect_erro(label TEXT, sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ok: % (barrado: %)', label, left(SQLERRM, 80);
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o comando PASSOU e deveria ter sido barrado', label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_erro_com(label TEXT, sql TEXT, trecho TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    -- Recusa pelo motivo ERRADO e falha: um erro de tipo na funcao barraria
    -- todos estes casos e eles passariam verdes sem medir nada.
    IF position(trecho IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'FALHA: % -> barrado, mas por outro motivo: %', label, SQLERRM;
    END IF;
    RAISE NOTICE 'ok: % (barrado: %)', label, left(SQLERRM, 80);
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o comando PASSOU e deveria ter sido barrado', label;
END $$;

-- =====================================================
-- Fixture
-- =====================================================
--   Helio a1, Lais b1, Leticia c1, Bia e1 (fora do grupo)
--   grupo Casa d1, grupo Outro d2
--   servico     8730cd96-d656-4c48-863e-673e1016a832  (personal_finance)
--   Moradia     b61d7949-2abc-430d-9bd0-02a146c1d9d8  (despesa, do seed)
INSERT INTO auth.users (id, email) VALUES
  ('a0670000-0000-0000-0000-0000000000a1', 'helio@fechamento.local'),
  ('a0670000-0000-0000-0000-0000000000b1', 'lais@fechamento.local'),
  ('a0670000-0000-0000-0000-0000000000c1', 'leticia@fechamento.local'),
  ('a0670000-0000-0000-0000-0000000000e1', 'bia@fechamento.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a0670000-0000-0000-0000-0000000000a1', 'Helio', FALSE),
  ('a0670000-0000-0000-0000-0000000000b1', 'Lais', FALSE),
  ('a0670000-0000-0000-0000-0000000000c1', 'Leticia', FALSE),
  ('a0670000-0000-0000-0000-0000000000e1', 'Bia', FALSE);

-- O criador entra sozinho como admin (trigger do 001); as outras duas a mao.
INSERT INTO public.expense_groups (id, name, created_by, group_code) VALUES
  ('a0670000-0000-0000-0000-0000000000d1', 'Casa', 'a0670000-0000-0000-0000-0000000000a1', 'FECH67'),
  ('a0670000-0000-0000-0000-0000000000d2', 'Outro', 'a0670000-0000-0000-0000-0000000000e1', 'OUTR67');
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('a0670000-0000-0000-0000-0000000000d1', 'a0670000-0000-0000-0000-0000000000b1', 'member', 'active'),
  ('a0670000-0000-0000-0000-0000000000d1', 'a0670000-0000-0000-0000-0000000000c1', 'member', 'active');

-- As despesas do periodo 1. O trigger do 024/042 cria `group_transactions`.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, group_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0670000-0000-0000-0000-0000000000f1', 'a0670000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0670000-0000-0000-0000-0000000000d1', 'Aluguel', -1000.00, DATE '2026-10-12', 'expense'),
  ('a0670000-0000-0000-0000-0000000000f2', 'a0670000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0670000-0000-0000-0000-0000000000d1', 'Condominio', -500.00, DATE '2026-11-02', 'expense'),
  ('a0670000-0000-0000-0000-0000000000f3', 'a0670000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0670000-0000-0000-0000-0000000000d1', 'Mercado', -500.00, DATE '2026-10-20', 'expense'),
  -- de OUTRO grupo: nao pode entrar no fechamento da Casa
  ('a0670000-0000-0000-0000-0000000000f9', 'a0670000-0000-0000-0000-0000000000e1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0670000-0000-0000-0000-0000000000d2', 'Outro', -50.00, DATE '2026-10-15', 'expense');

SELECT pg_temp.expect('o trigger ligou as tres despesas da Casa',
  (SELECT count(*) FROM public.group_transactions
    WHERE group_id = 'a0670000-0000-0000-0000-0000000000d1'), 3);

-- O fechamento do periodo 1, como o cron manda.
CREATE TEMP TABLE fechamento (nome text PRIMARY KEY, corpo jsonb) ON COMMIT DROP;
INSERT INTO fechamento VALUES ('p1', $json$
{ "total": 2000.00,
  "membros": [
    { "user_id": "a0670000-0000-0000-0000-0000000000a1", "percentual": 50, "pago": 1500.00, "acertos": 0, "responsabilidade": 1000.00, "saldo": 500.00 },
    { "user_id": "a0670000-0000-0000-0000-0000000000b1", "percentual": 30, "pago": 500.00, "acertos": 0, "responsabilidade": 600.00, "saldo": -100.00 },
    { "user_id": "a0670000-0000-0000-0000-0000000000c1", "percentual": 20, "pago": 0, "acertos": 0, "responsabilidade": 400.00, "saldo": -400.00 }
  ],
  "itens": [
    { "kind": "despesa", "transaction_id": "a0670000-0000-0000-0000-0000000000f1", "from_user_id": "a0670000-0000-0000-0000-0000000000a1", "amount": 1000.00, "item_date": "2026-10-12", "description": "Aluguel" },
    { "kind": "despesa", "transaction_id": "a0670000-0000-0000-0000-0000000000f2", "from_user_id": "a0670000-0000-0000-0000-0000000000a1", "amount": 500.00, "item_date": "2026-11-02", "description": "Condominio" },
    { "kind": "despesa", "transaction_id": "a0670000-0000-0000-0000-0000000000f3", "from_user_id": "a0670000-0000-0000-0000-0000000000b1", "amount": 500.00, "item_date": "2026-10-20", "description": "Mercado" }
  ],
  "contas": [
    { "user_id": "a0670000-0000-0000-0000-0000000000a1", "tipo": "income", "valor": 500.00 },
    { "user_id": "a0670000-0000-0000-0000-0000000000b1", "tipo": "expense", "valor": 100.00 },
    { "user_id": "a0670000-0000-0000-0000-0000000000c1", "tipo": "expense", "valor": 400.00 }
  ] }
$json$::jsonb);
GRANT SELECT ON fechamento TO service_role, authenticated;

-- =====================================================
-- SECAO 1: o dia de fechamento
-- =====================================================
SELECT pg_temp.expect_erro_com('dia 0 e recusado',
  $$UPDATE public.expense_groups SET closing_day = 0 WHERE id = 'a0670000-0000-0000-0000-0000000000d1'$$,
  'expense_groups_closing_day_check');
SELECT pg_temp.expect_erro_com('dia 29 e recusado',
  $$UPDATE public.expense_groups SET closing_day = 29 WHERE id = 'a0670000-0000-0000-0000-0000000000d1'$$,
  'expense_groups_closing_day_check');

UPDATE public.expense_groups SET closing_day = 28 WHERE id = 'a0670000-0000-0000-0000-0000000000d1';
UPDATE public.expense_groups SET closing_day = NULL WHERE id = 'a0670000-0000-0000-0000-0000000000d1';
UPDATE public.expense_groups SET closing_day = 9 WHERE id = 'a0670000-0000-0000-0000-0000000000d1';
SELECT pg_temp.expect('dia 9 gravado',
  (SELECT closing_day FROM public.expense_groups WHERE id = 'a0670000-0000-0000-0000-0000000000d1'), 9);

-- =====================================================
-- SECAO 2: as somas erradas sao recusadas, e nada fica gravado
-- =====================================================
-- Cada caso parte do corpo certo e estraga UMA coisa. Rodam ANTES do
-- fechamento certo, como service_role, para provar que a recusa desfaz o
-- `group_closings` que a funcao ja tinha inserido.
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.sub = '';

SELECT pg_temp.expect_erro_com('total que nao e a soma das despesas',
  format($$SELECT public.registrar_fechamento_do_grupo('a0670000-0000-0000-0000-0000000000d1', DATE '2026-10-10', DATE '2026-11-09', %L)$$,
    jsonb_set((SELECT corpo FROM fechamento WHERE nome = 'p1'), '{total}', '1999.99')),
  'nao e a soma das despesas');

SELECT pg_temp.expect_erro_com('saldo que nao e pago + acertos - responsabilidade',
  format($$SELECT public.registrar_fechamento_do_grupo('a0670000-0000-0000-0000-0000000000d1', DATE '2026-10-10', DATE '2026-11-09', %L)$$,
    jsonb_set((SELECT corpo FROM fechamento WHERE nome = 'p1'), '{membros,0,saldo}', '400.00')),
  'nao confere com os itens');

SELECT pg_temp.expect_erro_com('pago que nao e a soma das despesas do membro',
  format($$SELECT public.registrar_fechamento_do_grupo('a0670000-0000-0000-0000-0000000000d1', DATE '2026-10-10', DATE '2026-11-09', %L)$$,
    jsonb_set(jsonb_set((SELECT corpo FROM fechamento WHERE nome = 'p1'),
      '{membros,0,pago}', '1400.00'), '{membros,0,saldo}', '400.00')),
  'nao confere com os itens');

SELECT pg_temp.expect_erro_com('responsabilidades que nao somam o total',
  format($$SELECT public.registrar_fechamento_do_grupo('a0670000-0000-0000-0000-0000000000d1', DATE '2026-10-10', DATE '2026-11-09', %L)$$,
    jsonb_set(jsonb_set((SELECT corpo FROM fechamento WHERE nome = 'p1'),
      '{membros,2,responsabilidade}', '300.00'), '{membros,2,saldo}', '-300.00')),
  'a soma das responsabilidades nao e o total');

SELECT pg_temp.expect_erro_com('conta com valor que nao e o saldo',
  format($$SELECT public.registrar_fechamento_do_grupo('a0670000-0000-0000-0000-0000000000d1', DATE '2026-10-10', DATE '2026-11-09', %L)$$,
    jsonb_set((SELECT corpo FROM fechamento WHERE nome = 'p1'), '{contas,2,valor}', '0.01')),
  'as contas nao sao os saldos');

SELECT pg_temp.expect_erro_com('conta faltando para um saldo',
  format($$SELECT public.registrar_fechamento_do_grupo('a0670000-0000-0000-0000-0000000000d1', DATE '2026-10-10', DATE '2026-11-09', %L)$$,
    (SELECT corpo FROM fechamento WHERE nome = 'p1') #- '{contas,2}'),
  'as contas nao sao os saldos');

SELECT pg_temp.expect_erro_com('conta do tipo trocado',
  format($$SELECT public.registrar_fechamento_do_grupo('a0670000-0000-0000-0000-0000000000d1', DATE '2026-10-10', DATE '2026-11-09', %L)$$,
    jsonb_set((SELECT corpo FROM fechamento WHERE nome = 'p1'), '{contas,1,tipo}', '"income"')),
  'as contas nao sao os saldos');

SELECT pg_temp.expect_erro_com('despesa de outro grupo',
  format($$SELECT public.registrar_fechamento_do_grupo('a0670000-0000-0000-0000-0000000000d1', DATE '2026-10-10', DATE '2026-11-09', %L)$$,
    jsonb_set((SELECT corpo FROM fechamento WHERE nome = 'p1'), '{itens,2,transaction_id}',
      '"a0670000-0000-0000-0000-0000000000f9"')),
  'nao confere com o grupo');

SELECT pg_temp.expect_erro_com('despesa com pagador trocado',
  format($$SELECT public.registrar_fechamento_do_grupo('a0670000-0000-0000-0000-0000000000d1', DATE '2026-10-10', DATE '2026-11-09', %L)$$,
    jsonb_set((SELECT corpo FROM fechamento WHERE nome = 'p1'), '{itens,2,from_user_id}',
      '"a0670000-0000-0000-0000-0000000000c1"')),
  'nao confere com o grupo');

-- O condominio e de 02/11: com o periodo terminando 01/11 ele esta depois do
-- fim, e o banco recusa mesmo com as somas certas.
SELECT pg_temp.expect_erro_com('item depois do fim do periodo',
  format($$SELECT public.registrar_fechamento_do_grupo('a0670000-0000-0000-0000-0000000000d1', DATE '2026-10-10', DATE '2026-11-01', %L)$$,
    (SELECT corpo FROM fechamento WHERE nome = 'p1')),
  'nao confere com o grupo');

SELECT pg_temp.expect_erro_com('membro repetido na foto',
  format($$SELECT public.registrar_fechamento_do_grupo('a0670000-0000-0000-0000-0000000000d1', DATE '2026-10-10', DATE '2026-11-09', %L)$$,
    jsonb_set((SELECT corpo FROM fechamento WHERE nome = 'p1'), '{membros}',
      ((SELECT corpo FROM fechamento WHERE nome = 'p1')->'membros')
      || jsonb_build_array(((SELECT corpo FROM fechamento WHERE nome = 'p1')->'membros'->2)))),
  'membro repetido');

RESET ROLE;

SELECT pg_temp.expect('nenhuma recusa deixou fechamento gravado',
  (SELECT count(*) FROM public.group_closings
    WHERE group_id = 'a0670000-0000-0000-0000-0000000000d1'), 0);
SELECT pg_temp.expect('nenhuma recusa deixou conta gerada',
  (SELECT count(*) FROM public.scheduled_transactions WHERE group_closing_id IS NOT NULL), 0);

-- =====================================================
-- SECAO 3: so service_role executa
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0670000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_erro_com('o admin do grupo nao executa a funcao pela API',
  format($$SELECT public.registrar_fechamento_do_grupo('a0670000-0000-0000-0000-0000000000d1', DATE '2026-10-10', DATE '2026-11-09', %L)$$,
    (SELECT corpo FROM fechamento WHERE nome = 'p1')),
  'permission denied');

RESET ROLE;

-- =====================================================
-- SECAO 4: o fechamento certo
-- =====================================================
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.sub = '';

CREATE TEMP TABLE ids (nome text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT ALL ON ids TO service_role, authenticated;
INSERT INTO ids SELECT 'p1', public.registrar_fechamento_do_grupo(
  'a0670000-0000-0000-0000-0000000000d1', DATE '2026-10-10', DATE '2026-11-09',
  (SELECT corpo FROM fechamento WHERE nome = 'p1'));

RESET ROLE;

SELECT pg_temp.expect('o fechamento devolveu um id',
  (SELECT count(*) FROM ids WHERE nome = 'p1' AND id IS NOT NULL), 1);
SELECT pg_temp.expect('tres itens no fechamento',
  (SELECT count(*) FROM public.group_closing_items
    WHERE closing_id = (SELECT id FROM ids WHERE nome = 'p1')), 3);
SELECT pg_temp.expect('tres contas geradas',
  (SELECT count(*) FROM public.scheduled_transactions
    WHERE group_closing_id = (SELECT id FROM ids WHERE nome = 'p1')), 3);

SELECT pg_temp.expect_text('o Helio tem a receber R$ 500, receita',
  (SELECT description || ' | ' || amount || ' | ' || transaction_type
     FROM public.scheduled_transactions
    WHERE group_closing_id = (SELECT id FROM ids WHERE nome = 'p1')
      AND user_id = 'a0670000-0000-0000-0000-0000000000a1'),
  'A receber do grupo Casa | 500.00 | income');
SELECT pg_temp.expect_text('a Lais tem pagamento de R$ 100, despesa',
  (SELECT description || ' | ' || amount || ' | ' || transaction_type
     FROM public.scheduled_transactions
    WHERE group_closing_id = (SELECT id FROM ids WHERE nome = 'p1')
      AND user_id = 'a0670000-0000-0000-0000-0000000000b1'),
  'Pagamento ao grupo Casa | 100.00 | expense');
SELECT pg_temp.expect_text('a Leticia tem pagamento de R$ 400, despesa',
  (SELECT description || ' | ' || amount || ' | ' || transaction_type
     FROM public.scheduled_transactions
    WHERE group_closing_id = (SELECT id FROM ids WHERE nome = 'p1')
      AND user_id = 'a0670000-0000-0000-0000-0000000000c1'),
  'Pagamento ao grupo Casa | 400.00 | expense');

SELECT pg_temp.expect('as tres vencem no dia do fechamento (RN018.5)',
  (SELECT count(*) FROM public.scheduled_transactions
    WHERE group_closing_id = (SELECT id FROM ids WHERE nome = 'p1')
      AND due_date = DATE '2026-11-09' AND status = 'pending'), 3);
SELECT pg_temp.expect('nenhuma leva group_id: sao do membro, nao do grupo',
  (SELECT count(*) FROM public.scheduled_transactions
    WHERE group_closing_id = (SELECT id FROM ids WHERE nome = 'p1')
      AND group_id IS NOT NULL), 0);
SELECT pg_temp.expect('as categorias sao as reservadas',
  (SELECT count(*) FROM public.scheduled_transactions
    WHERE group_closing_id = (SELECT id FROM ids WHERE nome = 'p1')
      AND category_id = CASE transaction_type
            WHEN 'expense' THEN '2d0cd129-b5a6-400f-b3b4-702c72ced10e'::uuid
            ELSE 'f17cbc31-ce0d-4ee8-aa0c-1541736e4ad5'::uuid END), 3);

-- A foto do fechamento guarda o que valeu.
SELECT pg_temp.expect_num('a foto guarda o % da Lais',
  (SELECT (m->>'percentual')::numeric
     FROM public.group_closings c, jsonb_array_elements(c.members) m
    WHERE c.id = (SELECT id FROM ids WHERE nome = 'p1')
      AND m->>'user_id' = 'a0670000-0000-0000-0000-0000000000b1'), 30);

-- =====================================================
-- SECAO 5: o cron de novo no mesmo dia
-- =====================================================
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.sub = '';

SELECT pg_temp.expect('o mesmo periodo de novo devolve NULL',
  (SELECT count(*) FROM (SELECT public.registrar_fechamento_do_grupo(
     'a0670000-0000-0000-0000-0000000000d1', DATE '2026-10-10', DATE '2026-11-09',
     (SELECT corpo FROM fechamento WHERE nome = 'p1')) AS id) r WHERE r.id IS NULL), 1);

RESET ROLE;

SELECT pg_temp.expect('continua um fechamento so',
  (SELECT count(*) FROM public.group_closings
    WHERE group_id = 'a0670000-0000-0000-0000-0000000000d1'), 1);
SELECT pg_temp.expect('continuam tres contas',
  (SELECT count(*) FROM public.scheduled_transactions WHERE group_closing_id IS NOT NULL), 3);

-- =====================================================
-- SECAO 6: a mesma despesa em dois fechamentos
-- =====================================================
-- O periodo 2 traz o aluguel do periodo 1 de novo. O indice unico recusa, e o
-- fechamento do periodo 2 inteiro volta atras.
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.sub = '';

SELECT pg_temp.expect_erro_com('o aluguel ja fechado nao entra de novo',
  $$SELECT public.registrar_fechamento_do_grupo(
      'a0670000-0000-0000-0000-0000000000d1', DATE '2026-11-10', DATE '2026-12-09',
      '{ "total": 1000.00,
         "membros": [
           { "user_id": "a0670000-0000-0000-0000-0000000000a1", "percentual": 50, "pago": 1000.00, "acertos": 0, "responsabilidade": 500.00, "saldo": 500.00 },
           { "user_id": "a0670000-0000-0000-0000-0000000000b1", "percentual": 30, "pago": 0, "acertos": 0, "responsabilidade": 300.00, "saldo": -300.00 },
           { "user_id": "a0670000-0000-0000-0000-0000000000c1", "percentual": 20, "pago": 0, "acertos": 0, "responsabilidade": 200.00, "saldo": -200.00 } ],
         "itens": [
           { "kind": "despesa", "transaction_id": "a0670000-0000-0000-0000-0000000000f1", "from_user_id": "a0670000-0000-0000-0000-0000000000a1", "amount": 1000.00, "item_date": "2026-10-12" } ],
         "contas": [
           { "user_id": "a0670000-0000-0000-0000-0000000000a1", "tipo": "income", "valor": 500.00 },
           { "user_id": "a0670000-0000-0000-0000-0000000000b1", "tipo": "expense", "valor": 300.00 },
           { "user_id": "a0670000-0000-0000-0000-0000000000c1", "tipo": "expense", "valor": 200.00 } ] }'::jsonb)$$,
  'group_closing_items_transaction_key');

RESET ROLE;

SELECT pg_temp.expect('o periodo 2 nao ficou gravado pela metade',
  (SELECT count(*) FROM public.group_closings
    WHERE group_id = 'a0670000-0000-0000-0000-0000000000d1'
      AND period_end = DATE '2026-12-09'), 0);

-- =====================================================
-- SECAO 7: o periodo 2, com despesa atrasada e acerto antigo
-- =====================================================
-- A Leticia paga R$ 300 em 20/11. A Lais lanca, DEPOIS do fechamento 1, uma
-- despesa de R$ 100 com data de 25/10 -- periodo ja fechado, entao ela entra no
-- proximo (RN018.3). E a Lais manda R$ 50 ao Helio pelo acerto antigo, que entra
-- como acerto (RN018.11).
--
--   total 400; responsabilidade H 200, L 120, T 80
--   pago  H 0, L 100, T 300; acertos H -50, L +50
--   saldo H -250, L +30, T +220
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, group_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0670000-0000-0000-0000-0000000000f4', 'a0670000-0000-0000-0000-0000000000c1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0670000-0000-0000-0000-0000000000d1', 'Luz', -300.00, DATE '2026-11-20', 'expense'),
  ('a0670000-0000-0000-0000-0000000000f5', 'a0670000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0670000-0000-0000-0000-0000000000d1', 'Feira atrasada', -100.00, DATE '2026-10-25', 'expense');

INSERT INTO public.group_settlements (id, group_id, from_user_id, to_user_id, amount, settled_on, created_by)
VALUES ('a0670000-0000-0000-0000-0000000000a9', 'a0670000-0000-0000-0000-0000000000d1',
        'a0670000-0000-0000-0000-0000000000b1', 'a0670000-0000-0000-0000-0000000000a1',
        50.00, DATE '2026-11-15', 'a0670000-0000-0000-0000-0000000000b1');

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.sub = '';

INSERT INTO ids SELECT 'p2', public.registrar_fechamento_do_grupo(
  'a0670000-0000-0000-0000-0000000000d1', DATE '2026-11-10', DATE '2026-12-09',
  '{ "total": 400.00,
     "membros": [
       { "user_id": "a0670000-0000-0000-0000-0000000000a1", "percentual": 50, "pago": 0, "acertos": -50.00, "responsabilidade": 200.00, "saldo": -250.00 },
       { "user_id": "a0670000-0000-0000-0000-0000000000b1", "percentual": 30, "pago": 100.00, "acertos": 50.00, "responsabilidade": 120.00, "saldo": 30.00 },
       { "user_id": "a0670000-0000-0000-0000-0000000000c1", "percentual": 20, "pago": 300.00, "acertos": 0, "responsabilidade": 80.00, "saldo": 220.00 } ],
     "itens": [
       { "kind": "despesa", "transaction_id": "a0670000-0000-0000-0000-0000000000f4", "from_user_id": "a0670000-0000-0000-0000-0000000000c1", "amount": 300.00, "item_date": "2026-11-20", "description": "Luz" },
       { "kind": "despesa", "transaction_id": "a0670000-0000-0000-0000-0000000000f5", "from_user_id": "a0670000-0000-0000-0000-0000000000b1", "amount": 100.00, "item_date": "2026-10-25", "description": "Feira atrasada" },
       { "kind": "acerto", "settlement_id": "a0670000-0000-0000-0000-0000000000a9", "from_user_id": "a0670000-0000-0000-0000-0000000000b1", "to_user_id": "a0670000-0000-0000-0000-0000000000a1", "amount": 50.00, "item_date": "2026-11-15" } ],
     "contas": [
       { "user_id": "a0670000-0000-0000-0000-0000000000a1", "tipo": "expense", "valor": 250.00 },
       { "user_id": "a0670000-0000-0000-0000-0000000000b1", "tipo": "income", "valor": 30.00 },
       { "user_id": "a0670000-0000-0000-0000-0000000000c1", "tipo": "income", "valor": 220.00 } ] }'::jsonb);

RESET ROLE;

SELECT pg_temp.expect('o periodo 2 fechou',
  (SELECT count(*) FROM ids WHERE nome = 'p2' AND id IS NOT NULL), 1);
SELECT pg_temp.expect('a despesa atrasada entrou no periodo 2',
  (SELECT count(*) FROM public.group_closing_items
    WHERE closing_id = (SELECT id FROM ids WHERE nome = 'p2')
      AND transaction_id = 'a0670000-0000-0000-0000-0000000000f5'), 1);
SELECT pg_temp.expect('o acerto antigo entrou no periodo 2',
  (SELECT count(*) FROM public.group_closing_items
    WHERE closing_id = (SELECT id FROM ids WHERE nome = 'p2')
      AND settlement_id = 'a0670000-0000-0000-0000-0000000000a9'), 1);
SELECT pg_temp.expect_num('o Helio deve R$ 250 no periodo 2',
  (SELECT amount FROM public.scheduled_transactions
    WHERE group_closing_id = (SELECT id FROM ids WHERE nome = 'p2')
      AND user_id = 'a0670000-0000-0000-0000-0000000000a1'
      AND transaction_type = 'expense'), 250.00);

-- O mesmo acerto num terceiro fechamento: recusado pelo indice do acerto.
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.sub = '';

SELECT pg_temp.expect_erro_com('o acerto ja fechado nao entra de novo',
  $$SELECT public.registrar_fechamento_do_grupo(
      'a0670000-0000-0000-0000-0000000000d1', DATE '2026-12-10', DATE '2027-01-09',
      '{ "total": 0,
         "membros": [
           { "user_id": "a0670000-0000-0000-0000-0000000000a1", "percentual": 50, "pago": 0, "acertos": -50.00, "responsabilidade": 0, "saldo": -50.00 },
           { "user_id": "a0670000-0000-0000-0000-0000000000b1", "percentual": 30, "pago": 0, "acertos": 50.00, "responsabilidade": 0, "saldo": 50.00 },
           { "user_id": "a0670000-0000-0000-0000-0000000000c1", "percentual": 20, "pago": 0, "acertos": 0, "responsabilidade": 0, "saldo": 0 } ],
         "itens": [
           { "kind": "acerto", "settlement_id": "a0670000-0000-0000-0000-0000000000a9", "from_user_id": "a0670000-0000-0000-0000-0000000000b1", "to_user_id": "a0670000-0000-0000-0000-0000000000a1", "amount": 50.00, "item_date": "2026-11-15" } ],
         "contas": [
           { "user_id": "a0670000-0000-0000-0000-0000000000a1", "tipo": "expense", "valor": 50.00 },
           { "user_id": "a0670000-0000-0000-0000-0000000000b1", "tipo": "income", "valor": 50.00 } ] }'::jsonb)$$,
  'group_closing_items_settlement_key');

RESET ROLE;

-- =====================================================
-- SECAO 8: quem le e quem escreve
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0670000-0000-0000-0000-0000000000b1';

SELECT pg_temp.expect('a Lais, membro, le os dois fechamentos',
  (SELECT count(*) FROM public.group_closings
    WHERE group_id = 'a0670000-0000-0000-0000-0000000000d1'), 2);
SELECT pg_temp.expect('a Lais le os seis itens',
  (SELECT count(*) FROM public.group_closing_items
    WHERE group_id = 'a0670000-0000-0000-0000-0000000000d1'), 6);
SELECT pg_temp.expect('a Lais le so as contas DELA',
  (SELECT count(*) FROM public.scheduled_transactions WHERE group_closing_id IS NOT NULL), 2);
SELECT pg_temp.expect('a Lais le a categoria reservada da conta dela',
  (SELECT count(*) FROM public.transaction_categories
    WHERE id IN ('2d0cd129-b5a6-400f-b3b4-702c72ced10e', 'f17cbc31-ce0d-4ee8-aa0c-1541736e4ad5')), 2);

SELECT pg_temp.expect_erro_com('a Lais nao escreve fechamento',
  $$INSERT INTO public.group_closings (group_id, period_start, period_end, total)
    VALUES ('a0670000-0000-0000-0000-0000000000d1', DATE '2027-01-10', DATE '2027-02-09', 0)$$,
  'permission denied');
SELECT pg_temp.expect_erro_com('a Lais nao apaga item',
  $$DELETE FROM public.group_closing_items WHERE group_id = 'a0670000-0000-0000-0000-0000000000d1'$$,
  'permission denied');

RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0670000-0000-0000-0000-0000000000e1';

SELECT pg_temp.expect('a Bia, de fora, nao le fechamento da Casa',
  (SELECT count(*) FROM public.group_closings
    WHERE group_id = 'a0670000-0000-0000-0000-0000000000d1'), 0);
SELECT pg_temp.expect('a Bia nao le item da Casa',
  (SELECT count(*) FROM public.group_closing_items
    WHERE group_id = 'a0670000-0000-0000-0000-0000000000d1'), 0);

RESET ROLE;

-- =====================================================
-- SECAO 9: a trava da conta gerada
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0670000-0000-0000-0000-0000000000c1';

-- Uma conta comum da Leticia, sem elo, para os casos que precisam de uma.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, description, amount, due_date, transaction_type)
VALUES ('a0670000-0000-0000-0000-0000000000a8', 'a0670000-0000-0000-0000-0000000000c1',
        'b61d7949-2abc-430d-9bd0-02a146c1d9d8', 'Internet', 100.00, DATE '2026-11-15', 'expense');

SELECT pg_temp.expect_erro_com('a Leticia nao baixa a propria divida para R$ 0,01',
  $$UPDATE public.scheduled_transactions SET amount = 0.01
     WHERE user_id = 'a0670000-0000-0000-0000-0000000000c1'
       AND group_closing_id = (SELECT id FROM ids WHERE nome = 'p1')$$,
  'RN018.12');
SELECT pg_temp.expect_erro_com('nem troca a despesa por receita',
  $$UPDATE public.scheduled_transactions SET transaction_type = 'income'
     WHERE user_id = 'a0670000-0000-0000-0000-0000000000c1'
       AND group_closing_id = (SELECT id FROM ids WHERE nome = 'p1')$$,
  'RN018.12');
SELECT pg_temp.expect_erro_com('nem empurra o vencimento',
  $$UPDATE public.scheduled_transactions SET due_date = DATE '2027-12-31'
     WHERE user_id = 'a0670000-0000-0000-0000-0000000000c1'
       AND group_closing_id = (SELECT id FROM ids WHERE nome = 'p1')$$,
  'RN018.12');
SELECT pg_temp.expect_erro_com('nem solta o elo com o fechamento',
  $$UPDATE public.scheduled_transactions SET group_closing_id = NULL
     WHERE user_id = 'a0670000-0000-0000-0000-0000000000c1'
       AND group_closing_id = (SELECT id FROM ids WHERE nome = 'p1')$$,
  'nao se edita');
SELECT pg_temp.expect_erro_com('nem cria conta com elo de fechamento',
  $$INSERT INTO public.scheduled_transactions
      (user_id, category_id, description, amount, due_date, transaction_type, group_closing_id)
    VALUES ('a0670000-0000-0000-0000-0000000000c1', 'f17cbc31-ce0d-4ee8-aa0c-1541736e4ad5',
            'Inventada', 999.00, DATE '2026-11-09', 'income', (SELECT id FROM ids WHERE nome = 'p1'))$$,
  'so nasce no fechamento');
SELECT pg_temp.expect_erro_com('nem poe elo numa conta comum',
  $$UPDATE public.scheduled_transactions SET group_closing_id = (SELECT id FROM ids WHERE nome = 'p1')
     WHERE user_id = 'a0670000-0000-0000-0000-0000000000c1' AND group_closing_id IS NULL$$,
  'so nasce no fechamento');

-- A baixa continua livre: e por ela que a conta e paga.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0670000-0000-0000-0000-0000000000f6', 'a0670000-0000-0000-0000-0000000000c1',
   '8730cd96-d656-4c48-863e-673e1016a832', '2d0cd129-b5a6-400f-b3b4-702c72ced10e',
   'Pagamento ao grupo Casa', -400.00, DATE '2026-11-09', 'expense');

UPDATE public.scheduled_transactions
   SET status = 'paid', paid_date = DATE '2026-11-09',
       transaction_id = 'a0670000-0000-0000-0000-0000000000f6'
 WHERE user_id = 'a0670000-0000-0000-0000-0000000000c1'
   AND group_closing_id = (SELECT id FROM ids WHERE nome = 'p1');

SELECT pg_temp.expect('a baixa da Leticia passou pela trava',
  (SELECT count(*) FROM public.scheduled_transactions
    WHERE user_id = 'a0670000-0000-0000-0000-0000000000c1'
      AND group_closing_id = (SELECT id FROM ids WHERE nome = 'p1')
      AND status = 'paid'), 1);

-- Conta comum, sem elo, continua editavel como sempre.
UPDATE public.scheduled_transactions SET amount = 120.00
 WHERE id = 'a0670000-0000-0000-0000-0000000000a8';
SELECT pg_temp.expect_num('a conta comum mudou de valor',
  (SELECT amount FROM public.scheduled_transactions
    WHERE id = 'a0670000-0000-0000-0000-0000000000a8'), 120.00);

RESET ROLE;

-- =====================================================
-- SECAO 10: apagar o fechamento solta o elo
-- =====================================================
-- Na sessao de um usuario do app (auth.uid() preenchido), como seria a do admin
-- apagando o grupo: o ON DELETE SET NULL roda pela trava, e ela deixa passar
-- porque o fechamento ja nao existe.
SET LOCAL request.jwt.claim.sub = 'a0670000-0000-0000-0000-0000000000a1';

DELETE FROM public.group_closings WHERE id = (SELECT id FROM ids WHERE nome = 'p2');

SELECT pg_temp.expect('as contas do periodo 2 ficaram sem elo',
  (SELECT count(*) FROM public.scheduled_transactions
    WHERE description LIKE '%grupo Casa' AND due_date = DATE '2026-12-09'
      AND group_closing_id IS NULL), 3);
SELECT pg_temp.expect('os itens do periodo 2 foram junto',
  (SELECT count(*) FROM public.group_closing_items
    WHERE closing_id = (SELECT id FROM ids WHERE nome = 'p2')), 0);

ROLLBACK;
