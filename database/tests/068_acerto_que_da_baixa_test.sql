-- =====================================================
-- Teste do acerto que da baixa (068)
-- =====================================================
-- Parte do fechamento do exemplo da RN018 (grupo Casa, 50/30/20, R$ 2.000):
--
--   Helio    A receber do grupo   R$ 500
--   Lais     Pagamento ao grupo   R$ 100
--   Leticia  Pagamento ao grupo   R$ 400
--
-- e prova, com os Pix de cada um:
--
--   1. o acerto da Lais (R$ 100) quita a conta dela e R$ 100 da do Helio, no
--      mesmo INSERT, pelo mesmo valor nos dois lados (RN019.1, RN019.3);
--   2. o acerto parcial da Leticia (R$ 150) deixa R$ 250 em aberto dos dois
--      lados (RN019.4), e o Pix para quem nao tem a receber nao quita nada;
--   3. editar o valor do acerto refaz a baixa;
--   4. o acerto maior que a divida quita o que havia e a SOBRA vai para o
--      proximo fechamento, e o fechamento recusa levar o valor cheio;
--   5. desfazer o acerto reabre as contas;
--   6. a conta gerada nao se quita pelo botao comum, nao se apaga e nao ganha
--      conta de pagamento; a conta prevista comum continua livre, e continua
--      sem poder ficar paga sem lancamento;
--   7. o acerto que entrou num fechamento nao se edita nem se desfaz;
--   8. o ciclo fecha: o segundo fechamento gera contas novas, e os acertos as
--      quitam ate nao sobrar nada em aberto; e quem fica devendo E tendo a
--      receber do mesmo grupo compensa os dois lados, sem acerto;
--   9. o fechamento cuja conta ja foi quitada nao se apaga;
--  10. RLS: membro le a baixa, quem nao e membro nao le, ninguem do app
--      escreve, e so membro ve as contas em aberto;
--  11. o grupo sem fechamento: o acerto nao quita nada, como antes da 068.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 068:
--   psql "$DB_URL" -f database/tests/068_acerto_que_da_baixa_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_erro_com(label TEXT, sql TEXT, trecho TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    -- Recusa pelo motivo ERRADO e falha: um erro de tipo na trava barraria
    -- todos estes casos e eles passariam verdes sem medir nada.
    IF position(trecho IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'FALHA: % -> barrado, mas por outro motivo: %', label, SQLERRM;
    END IF;
    RAISE NOTICE 'ok: % (barrado: %)', label, left(SQLERRM, 80);
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o comando PASSOU e deveria ter sido barrado', label;
END $$;

-- O que falta pagar numa conta gerada, lido direto (o teste roda como dono).
-- plpgsql, e nao sql, de proposito: o corpo so e lido na chamada. Num banco
-- sem a 068 a suite cai na primeira assercao que precisa da baixa, e nao na
-- criacao deste ajudante.
CREATE OR REPLACE FUNCTION pg_temp.aberto(p_scheduled uuid)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
BEGIN
  RETURN (SELECT st.amount - COALESCE((SELECT SUM(a.amount)
                                         FROM public.group_settlement_allocations a
                                        WHERE a.scheduled_id = st.id), 0)
            FROM public.scheduled_transactions st WHERE st.id = p_scheduled);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.status(p_scheduled uuid)
RETURNS TEXT LANGUAGE sql AS $$
  SELECT status::text FROM public.scheduled_transactions WHERE id = p_scheduled;
$$;

-- =====================================================
-- Fixture
-- =====================================================
--   Helio a1, Lais b1, Leticia c1, Bia e1 (fora da Casa)
--   grupo Casa d1 (com fechamento), grupo Outro d2 (sem fechamento)
--   servico  8730cd96-d656-4c48-863e-673e1016a832  (personal_finance)
--   Moradia  b61d7949-2abc-430d-9bd0-02a146c1d9d8  (despesa, do seed)
INSERT INTO auth.users (id, email) VALUES
  ('a0680000-0000-0000-0000-0000000000a1', 'helio@acerto.local'),
  ('a0680000-0000-0000-0000-0000000000b1', 'lais@acerto.local'),
  ('a0680000-0000-0000-0000-0000000000c1', 'leticia@acerto.local'),
  ('a0680000-0000-0000-0000-0000000000e1', 'bia@acerto.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a0680000-0000-0000-0000-0000000000a1', 'Helio', FALSE),
  ('a0680000-0000-0000-0000-0000000000b1', 'Lais', FALSE),
  ('a0680000-0000-0000-0000-0000000000c1', 'Leticia', FALSE),
  ('a0680000-0000-0000-0000-0000000000e1', 'Bia', FALSE);

INSERT INTO public.expense_groups (id, name, created_by, group_code, closing_day) VALUES
  ('a0680000-0000-0000-0000-0000000000d1', 'Casa', 'a0680000-0000-0000-0000-0000000000a1', 'ACER68', 9),
  ('a0680000-0000-0000-0000-0000000000d2', 'Outro', 'a0680000-0000-0000-0000-0000000000e1', 'OUTR68', NULL);
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('a0680000-0000-0000-0000-0000000000d1', 'a0680000-0000-0000-0000-0000000000b1', 'member', 'active'),
  ('a0680000-0000-0000-0000-0000000000d1', 'a0680000-0000-0000-0000-0000000000c1', 'member', 'active'),
  ('a0680000-0000-0000-0000-0000000000d2', 'a0680000-0000-0000-0000-0000000000b1', 'member', 'active');

INSERT INTO public.financial_accounts (id, user_id, name, account_type) VALUES
  ('a0680000-0000-0000-0000-0000000000ab', 'a0680000-0000-0000-0000-0000000000b1', 'Conta da Lais', 'checking');

-- As despesas do periodo 1 (o trigger do 024/042 cria `group_transactions`).
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, group_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0680000-0000-0000-0000-0000000000f1', 'a0680000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0680000-0000-0000-0000-0000000000d1', 'Aluguel', -1500.00, DATE '2026-10-12', 'expense'),
  ('a0680000-0000-0000-0000-0000000000f2', 'a0680000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0680000-0000-0000-0000-0000000000d1', 'Mercado', -500.00, DATE '2026-10-20', 'expense');

-- O fechamento do periodo 1, como o cron manda.
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.sub = '';
SELECT public.registrar_fechamento_do_grupo(
  'a0680000-0000-0000-0000-0000000000d1', DATE '2026-10-10', DATE '2026-11-09', $json$
{ "total": 2000.00,
  "membros": [
    { "user_id": "a0680000-0000-0000-0000-0000000000a1", "percentual": 50, "pago": 1500.00, "acertos": 0, "responsabilidade": 1000.00, "saldo": 500.00 },
    { "user_id": "a0680000-0000-0000-0000-0000000000b1", "percentual": 30, "pago": 500.00, "acertos": 0, "responsabilidade": 600.00, "saldo": -100.00 },
    { "user_id": "a0680000-0000-0000-0000-0000000000c1", "percentual": 20, "pago": 0, "acertos": 0, "responsabilidade": 400.00, "saldo": -400.00 }
  ],
  "itens": [
    { "kind": "despesa", "transaction_id": "a0680000-0000-0000-0000-0000000000f1", "from_user_id": "a0680000-0000-0000-0000-0000000000a1", "amount": 1500.00, "item_date": "2026-10-12", "description": "Aluguel" },
    { "kind": "despesa", "transaction_id": "a0680000-0000-0000-0000-0000000000f2", "from_user_id": "a0680000-0000-0000-0000-0000000000b1", "amount": 500.00, "item_date": "2026-10-20", "description": "Mercado" }
  ],
  "contas": [
    { "user_id": "a0680000-0000-0000-0000-0000000000a1", "tipo": "income", "valor": 500.00 },
    { "user_id": "a0680000-0000-0000-0000-0000000000b1", "tipo": "expense", "valor": 100.00 },
    { "user_id": "a0680000-0000-0000-0000-0000000000c1", "tipo": "expense", "valor": 400.00 }
  ] }
$json$::jsonb);
RESET ROLE;

-- As tres contas geradas, pelo dono.
CREATE TEMP TABLE conta (quem text PRIMARY KEY, id uuid) ON COMMIT DROP;
INSERT INTO conta
SELECT CASE st.user_id
         WHEN 'a0680000-0000-0000-0000-0000000000a1' THEN 'helio'
         WHEN 'a0680000-0000-0000-0000-0000000000b1' THEN 'lais'
         WHEN 'a0680000-0000-0000-0000-0000000000c1' THEN 'leticia'
       END, st.id
  FROM public.scheduled_transactions st
 WHERE st.group_closing_id IS NOT NULL
   AND st.user_id IN ('a0680000-0000-0000-0000-0000000000a1',
                      'a0680000-0000-0000-0000-0000000000b1',
                      'a0680000-0000-0000-0000-0000000000c1');
GRANT SELECT ON conta TO authenticated, service_role;

SELECT pg_temp.expect('o fechamento gerou as tres contas', (SELECT count(*) FROM conta), 3);

-- =====================================================
-- SECAO 1: o acerto da Lais quita a conta dela e R$ 100 da do Helio
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000b1';
INSERT INTO public.group_settlements
  (id, group_id, from_user_id, to_user_id, amount, settled_on, created_by)
VALUES
  ('a0680000-0000-0000-0000-000000000051', 'a0680000-0000-0000-0000-0000000000d1',
   'a0680000-0000-0000-0000-0000000000b1', 'a0680000-0000-0000-0000-0000000000a1',
   100.00, DATE '2026-11-10', 'a0680000-0000-0000-0000-0000000000b1');
RESET ROLE;

SELECT pg_temp.expect('o acerto deu baixa nas duas contas, no mesmo INSERT',
  (SELECT count(*) FROM public.group_settlement_allocations
    WHERE settlement_id = 'a0680000-0000-0000-0000-000000000051'), 2);
SELECT pg_temp.expect_text('a conta da Lais esta paga',
  pg_temp.status((SELECT id FROM conta WHERE quem = 'lais')), 'paid');
SELECT pg_temp.expect_text('paga na data do acerto, sem lancamento proprio',
  (SELECT paid_date::text || '/' || COALESCE(transaction_id::text, 'sem lancamento')
     FROM public.scheduled_transactions WHERE id = (SELECT id FROM conta WHERE quem = 'lais')),
  '2026-11-10/sem lancamento');
SELECT pg_temp.expect_num('o Helio ainda tem R$ 400 a receber',
  pg_temp.aberto((SELECT id FROM conta WHERE quem = 'helio')), 400.00);
SELECT pg_temp.expect_text('e a conta dele continua aberta',
  pg_temp.status((SELECT id FROM conta WHERE quem = 'helio')), 'pending');
-- Controle: a Leticia nao pagou nada e nao pode ter baixa nenhuma.
SELECT pg_temp.expect_num('a conta da Leticia nao foi tocada',
  pg_temp.aberto((SELECT id FROM conta WHERE quem = 'leticia')), 400.00);

-- =====================================================
-- SECAO 2: o acerto parcial da Leticia (RN019.4)
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000c1';
INSERT INTO public.group_settlements
  (id, group_id, from_user_id, to_user_id, amount, settled_on, created_by)
VALUES
  ('a0680000-0000-0000-0000-000000000052', 'a0680000-0000-0000-0000-0000000000d1',
   'a0680000-0000-0000-0000-0000000000c1', 'a0680000-0000-0000-0000-0000000000a1',
   150.00, DATE '2026-11-11', 'a0680000-0000-0000-0000-0000000000c1');
RESET ROLE;

SELECT pg_temp.expect_num('a Leticia ainda deve R$ 250',
  pg_temp.aberto((SELECT id FROM conta WHERE quem = 'leticia')), 250.00);
SELECT pg_temp.expect_text('e a conta dela continua aberta',
  pg_temp.status((SELECT id FROM conta WHERE quem = 'leticia')), 'pending');
SELECT pg_temp.expect_num('o Helio ainda tem R$ 250 a receber',
  pg_temp.aberto((SELECT id FROM conta WHERE quem = 'helio')), 250.00);

-- O Pix para quem nao tem nada a receber do grupo nao quita nada: a Leticia
-- manda R$ 30 para a Lais, que DEVE ao grupo. Quitar a conta da Leticia sem
-- quitar nada do outro lado deixaria o grupo devendo R$ 30 ao Helio sem
-- ninguem para cobrar.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000c1';
INSERT INTO public.group_settlements
  (id, group_id, from_user_id, to_user_id, amount, settled_on, created_by)
VALUES
  ('a0680000-0000-0000-0000-00000000005a', 'a0680000-0000-0000-0000-0000000000d1',
   'a0680000-0000-0000-0000-0000000000c1', 'a0680000-0000-0000-0000-0000000000b1',
   30.00, DATE '2026-11-11', 'a0680000-0000-0000-0000-0000000000c1');
RESET ROLE;
SELECT pg_temp.expect('o Pix para quem nao tem a receber nao quita nada',
  (SELECT count(*) FROM public.group_settlement_allocations
    WHERE settlement_id = 'a0680000-0000-0000-0000-00000000005a'), 0);
SELECT pg_temp.expect_num('e a Leticia continua devendo R$ 250',
  pg_temp.aberto((SELECT id FROM conta WHERE quem = 'leticia')), 250.00);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000c1';
DELETE FROM public.group_settlements WHERE id = 'a0680000-0000-0000-0000-00000000005a';
RESET ROLE;

-- So membro ve o que esta em aberto; para quem nao e membro, nenhuma linha.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect('a Lais ve as duas contas em aberto do grupo',
  (SELECT count(*) FROM public.contas_em_aberto_do_grupo('a0680000-0000-0000-0000-0000000000d1')), 2);
SELECT pg_temp.expect_num('com o que falta em cada uma',
  (SELECT SUM(aberto) FROM public.contas_em_aberto_do_grupo('a0680000-0000-0000-0000-0000000000d1')), 500.00);
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000e1';
SELECT pg_temp.expect('a Bia, de fora, nao ve nada',
  (SELECT count(*) FROM public.contas_em_aberto_do_grupo('a0680000-0000-0000-0000-0000000000d1')), 0);
RESET ROLE;

-- =====================================================
-- SECAO 3: editar o valor do acerto refaz a baixa
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000b1';
UPDATE public.group_settlements SET amount = 40.00
 WHERE id = 'a0680000-0000-0000-0000-000000000051';
RESET ROLE;

SELECT pg_temp.expect_num('com R$ 40, a Lais volta a dever R$ 60',
  pg_temp.aberto((SELECT id FROM conta WHERE quem = 'lais')), 60.00);
SELECT pg_temp.expect_text('e a conta dela reabre',
  pg_temp.status((SELECT id FROM conta WHERE quem = 'lais')), 'pending');
SELECT pg_temp.expect_num('o Helio volta a ter R$ 310 a receber',
  pg_temp.aberto((SELECT id FROM conta WHERE quem = 'helio')), 310.00);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000b1';
UPDATE public.group_settlements SET amount = 100.00
 WHERE id = 'a0680000-0000-0000-0000-000000000051';
RESET ROLE;

SELECT pg_temp.expect_text('de volta a R$ 100, a conta da Lais esta paga de novo',
  pg_temp.status((SELECT id FROM conta WHERE quem = 'lais')), 'paid');
SELECT pg_temp.expect_num('e o Helio de volta a R$ 250',
  pg_temp.aberto((SELECT id FROM conta WHERE quem = 'helio')), 250.00);

-- =====================================================
-- SECAO 4: o acerto maior que a divida
-- =====================================================
-- A Leticia manda R$ 300 e devia R$ 250: quita os R$ 250 dela e os R$ 250
-- do Helio. Os R$ 50 de sobra vao para o proximo fechamento (SECAO 8).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000c1';
INSERT INTO public.group_settlements
  (id, group_id, from_user_id, to_user_id, amount, settled_on, created_by)
VALUES
  ('a0680000-0000-0000-0000-000000000053', 'a0680000-0000-0000-0000-0000000000d1',
   'a0680000-0000-0000-0000-0000000000c1', 'a0680000-0000-0000-0000-0000000000a1',
   300.00, DATE '2026-11-12', 'a0680000-0000-0000-0000-0000000000c1');
RESET ROLE;

SELECT pg_temp.expect_num('a baixa e de R$ 250 de cada lado, nao R$ 300',
  (SELECT SUM(amount) FROM public.group_settlement_allocations
    WHERE settlement_id = 'a0680000-0000-0000-0000-000000000053'), 500.00);
SELECT pg_temp.expect_text('a conta da Leticia esta paga',
  pg_temp.status((SELECT id FROM conta WHERE quem = 'leticia')), 'paid');
SELECT pg_temp.expect_text('a do Helio tambem',
  pg_temp.status((SELECT id FROM conta WHERE quem = 'helio')), 'paid');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect('nada mais em aberto no grupo',
  (SELECT count(*) FROM public.contas_em_aberto_do_grupo('a0680000-0000-0000-0000-0000000000d1')), 0);
RESET ROLE;

-- =====================================================
-- SECAO 5: desfazer o acerto reabre as contas
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000c1';
DELETE FROM public.group_settlements WHERE id = 'a0680000-0000-0000-0000-000000000053';
RESET ROLE;

SELECT pg_temp.expect('a baixa do acerto desfeito sumiu',
  (SELECT count(*) FROM public.group_settlement_allocations
    WHERE settlement_id = 'a0680000-0000-0000-0000-000000000053'), 0);
SELECT pg_temp.expect_text('a conta da Leticia reabriu',
  pg_temp.status((SELECT id FROM conta WHERE quem = 'leticia')), 'pending');
SELECT pg_temp.expect_text('sem data de baixa',
  COALESCE((SELECT paid_date::text FROM public.scheduled_transactions
             WHERE id = (SELECT id FROM conta WHERE quem = 'leticia')), 'sem data'),
  'sem data');
SELECT pg_temp.expect_num('com os R$ 250 de antes',
  pg_temp.aberto((SELECT id FROM conta WHERE quem = 'leticia')), 250.00);
SELECT pg_temp.expect_text('a do Helio tambem reabriu',
  pg_temp.status((SELECT id FROM conta WHERE quem = 'helio')), 'pending');
-- Controle: os outros dois acertos continuam valendo.
SELECT pg_temp.expect_text('a conta da Lais continua paga',
  pg_temp.status((SELECT id FROM conta WHERE quem = 'lais')), 'paid');

-- De novo, para o fechamento da SECAO 8.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000c1';
INSERT INTO public.group_settlements
  (id, group_id, from_user_id, to_user_id, amount, settled_on, created_by)
VALUES
  ('a0680000-0000-0000-0000-000000000054', 'a0680000-0000-0000-0000-0000000000d1',
   'a0680000-0000-0000-0000-0000000000c1', 'a0680000-0000-0000-0000-0000000000a1',
   300.00, DATE '2026-11-12', 'a0680000-0000-0000-0000-0000000000c1');
RESET ROLE;

-- =====================================================
-- SECAO 6: a trava da conta gerada
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000b1';

SELECT pg_temp.expect_erro_com('a Lais nao reabre a propria conta pelo botao comum',
  $$UPDATE public.scheduled_transactions SET status = 'pending', paid_date = NULL
     WHERE id = (SELECT id FROM conta WHERE quem = 'lais')$$,
  'se quita pelo acerto');

SELECT pg_temp.expect_erro_com('nem escolhe conta de pagamento para ela',
  $$UPDATE public.scheduled_transactions SET account_id = 'a0680000-0000-0000-0000-0000000000ab'
     WHERE id = (SELECT id FROM conta WHERE quem = 'lais')$$,
  'se quita pelo acerto');

SELECT pg_temp.expect_erro_com('nem a apaga',
  $$DELETE FROM public.scheduled_transactions WHERE id = (SELECT id FROM conta WHERE quem = 'lais')$$,
  'nao se apaga');

-- A conta prevista comum continua livre.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, description, amount, due_date, transaction_type)
VALUES
  ('a0680000-0000-0000-0000-0000000000aa', 'a0680000-0000-0000-0000-0000000000b1',
   'b61d7949-2abc-430d-9bd0-02a146c1d9d8', 'Internet', 100.00, DATE '2026-11-20', 'expense');
UPDATE public.scheduled_transactions SET amount = 120.00, account_id = 'a0680000-0000-0000-0000-0000000000ab'
 WHERE id = 'a0680000-0000-0000-0000-0000000000aa';
SELECT pg_temp.expect_num('a conta comum muda de valor e de conta',
  (SELECT amount FROM public.scheduled_transactions WHERE id = 'a0680000-0000-0000-0000-0000000000aa'), 120.00);

-- E continua sem poder ficar paga sem lancamento: o CHECK so abriu a
-- excecao para a conta gerada.
SELECT pg_temp.expect_erro_com('conta comum paga sem lancamento e recusada',
  $$UPDATE public.scheduled_transactions SET status = 'paid', paid_date = DATE '2026-11-20'
     WHERE id = 'a0680000-0000-0000-0000-0000000000aa'$$,
  'scheduled_transactions_paid_check');

DELETE FROM public.scheduled_transactions WHERE id = 'a0680000-0000-0000-0000-0000000000aa';
SELECT pg_temp.expect('a conta comum se apaga',
  (SELECT count(*) FROM public.scheduled_transactions WHERE id = 'a0680000-0000-0000-0000-0000000000aa'), 0);

RESET ROLE;

-- =====================================================
-- SECAO 7: RLS da baixa
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect('a Lais, membro, le a baixa do grupo',
  (SELECT count(*) FROM public.group_settlement_allocations
    WHERE group_id = 'a0680000-0000-0000-0000-0000000000d1'), 6);
SELECT pg_temp.expect_erro_com('mas nao escreve nela',
  $$INSERT INTO public.group_settlement_allocations (settlement_id, scheduled_id, group_id, user_id, amount)
    VALUES ('a0680000-0000-0000-0000-000000000051', (SELECT id FROM conta WHERE quem = 'helio'),
            'a0680000-0000-0000-0000-0000000000d1', 'a0680000-0000-0000-0000-0000000000a1', 1)$$,
  'permission denied');
SELECT pg_temp.expect_erro_com('nem chama a baixa na mao',
  $$SELECT public.alocar_acerto_nas_contas('a0680000-0000-0000-0000-000000000051')$$,
  'permission denied');
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000e1';
SELECT pg_temp.expect('a Bia, de fora, nao le a baixa da Casa',
  (SELECT count(*) FROM public.group_settlement_allocations
    WHERE group_id = 'a0680000-0000-0000-0000-0000000000d1'), 0);
RESET ROLE;

-- =====================================================
-- SECAO 8: o segundo fechamento leva so a sobra
-- =====================================================
-- Periodo 2: a Lais paga a luz de R$ 300 em 20/11. O acerto de R$ 300 da
-- Leticia quitou R$ 250 e sobrou R$ 50, que entram como acerto:
--
--   Helio    pago 0    acertos -50  parte 150  saldo -200
--   Lais     pago 300  acertos 0    parte  90  saldo +210
--   Leticia  pago 0    acertos +50  parte  60  saldo  -10
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, group_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0680000-0000-0000-0000-0000000000f3', 'a0680000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0680000-0000-0000-0000-0000000000d1', 'Luz', -300.00, DATE '2026-11-20', 'expense');

CREATE TEMP TABLE fechamento (nome text PRIMARY KEY, corpo jsonb) ON COMMIT DROP;
INSERT INTO fechamento VALUES ('p2', $json$
{ "total": 300.00,
  "membros": [
    { "user_id": "a0680000-0000-0000-0000-0000000000a1", "percentual": 50, "pago": 0, "acertos": -50.00, "responsabilidade": 150.00, "saldo": -200.00 },
    { "user_id": "a0680000-0000-0000-0000-0000000000b1", "percentual": 30, "pago": 300.00, "acertos": 0, "responsabilidade": 90.00, "saldo": 210.00 },
    { "user_id": "a0680000-0000-0000-0000-0000000000c1", "percentual": 20, "pago": 0, "acertos": 50.00, "responsabilidade": 60.00, "saldo": -10.00 }
  ],
  "itens": [
    { "kind": "despesa", "transaction_id": "a0680000-0000-0000-0000-0000000000f3", "from_user_id": "a0680000-0000-0000-0000-0000000000b1", "amount": 300.00, "item_date": "2026-11-20", "description": "Luz" },
    { "kind": "acerto", "settlement_id": "a0680000-0000-0000-0000-000000000054", "from_user_id": "a0680000-0000-0000-0000-0000000000c1", "to_user_id": "a0680000-0000-0000-0000-0000000000a1", "amount": 50.00, "item_date": "2026-11-12" }
  ],
  "contas": [
    { "user_id": "a0680000-0000-0000-0000-0000000000a1", "tipo": "expense", "valor": 200.00 },
    { "user_id": "a0680000-0000-0000-0000-0000000000b1", "tipo": "income", "valor": 210.00 },
    { "user_id": "a0680000-0000-0000-0000-0000000000c1", "tipo": "expense", "valor": 10.00 }
  ] }
$json$::jsonb);
GRANT SELECT ON fechamento TO service_role;

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.sub = '';

-- O valor cheio do acerto contaria duas vezes os R$ 250 que ja quitaram conta.
SELECT pg_temp.expect_erro_com('o fechamento nao leva o acerto pelo valor cheio',
  format($$SELECT public.registrar_fechamento_do_grupo('a0680000-0000-0000-0000-0000000000d1', DATE '2026-11-10', DATE '2026-12-09', %L)$$,
    jsonb_set((SELECT corpo FROM fechamento WHERE nome = 'p2'), '{itens,1,amount}', '300.00')),
  'entra pelo que sobrou da baixa');

-- O acerto da Lais quitou tudo: nao sobrou nada para entrar.
SELECT pg_temp.expect_erro_com('nem o acerto que a baixa consumiu inteiro',
  format($$SELECT public.registrar_fechamento_do_grupo('a0680000-0000-0000-0000-0000000000d1', DATE '2026-11-10', DATE '2026-12-09', %L)$$,
    jsonb_insert((SELECT corpo FROM fechamento WHERE nome = 'p2'), '{itens,2}',
      '{ "kind": "acerto", "settlement_id": "a0680000-0000-0000-0000-000000000051", "from_user_id": "a0680000-0000-0000-0000-0000000000b1", "to_user_id": "a0680000-0000-0000-0000-0000000000a1", "amount": 100.00, "item_date": "2026-11-10" }'::jsonb)),
  'entra pelo que sobrou da baixa');

SELECT pg_temp.expect('o fechamento do periodo 2, com a sobra, e aceito',
  (SELECT count(*) FROM (SELECT public.registrar_fechamento_do_grupo(
     'a0680000-0000-0000-0000-0000000000d1', DATE '2026-11-10', DATE '2026-12-09',
     (SELECT corpo FROM fechamento WHERE nome = 'p2')) AS id) x WHERE x.id IS NOT NULL), 1);
RESET ROLE;

INSERT INTO conta
SELECT CASE st.user_id
         WHEN 'a0680000-0000-0000-0000-0000000000a1' THEN 'helio2'
         WHEN 'a0680000-0000-0000-0000-0000000000b1' THEN 'lais2'
         WHEN 'a0680000-0000-0000-0000-0000000000c1' THEN 'leticia2'
       END, st.id
  FROM public.scheduled_transactions st
  JOIN public.group_closings c ON c.id = st.group_closing_id
 WHERE c.group_id = 'a0680000-0000-0000-0000-0000000000d1'
   AND c.period_end = DATE '2026-12-09';
SELECT pg_temp.expect('o periodo 2 gerou tres contas', (SELECT count(*) FROM conta WHERE quem LIKE '%2'), 3);

-- =====================================================
-- SECAO 9: o acerto que entrou num fechamento nao se edita nem se desfaz
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000c1';
SELECT pg_temp.expect_erro_com('a Leticia nao desfaz o acerto que entrou no fechamento',
  $$DELETE FROM public.group_settlements WHERE id = 'a0680000-0000-0000-0000-000000000054'$$,
  'ja entrou no fechamento');
SELECT pg_temp.expect_erro_com('nem muda o valor dele',
  $$UPDATE public.group_settlements SET amount = 10 WHERE id = 'a0680000-0000-0000-0000-000000000054'$$,
  'ja entrou no fechamento');
RESET ROLE;

-- =====================================================
-- SECAO 10: o ciclo fecha
-- =====================================================
-- O Helio deve R$ 200 e a Leticia R$ 10, a Lais tem R$ 210 a receber.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000a1';
INSERT INTO public.group_settlements
  (group_id, from_user_id, to_user_id, amount, settled_on, created_by)
VALUES
  ('a0680000-0000-0000-0000-0000000000d1', 'a0680000-0000-0000-0000-0000000000a1',
   'a0680000-0000-0000-0000-0000000000b1', 200.00, DATE '2026-12-10',
   'a0680000-0000-0000-0000-0000000000a1');
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000c1';
INSERT INTO public.group_settlements
  (group_id, from_user_id, to_user_id, amount, settled_on, created_by)
VALUES
  ('a0680000-0000-0000-0000-0000000000d1', 'a0680000-0000-0000-0000-0000000000c1',
   'a0680000-0000-0000-0000-0000000000b1', 10.00, DATE '2026-12-11',
   'a0680000-0000-0000-0000-0000000000c1');
SELECT pg_temp.expect('depois dos dois Pix, nada em aberto no grupo',
  (SELECT count(*) FROM public.contas_em_aberto_do_grupo('a0680000-0000-0000-0000-0000000000d1')), 0);
RESET ROLE;

SELECT pg_temp.expect('as seis contas geradas estao pagas',
  (SELECT count(*) FROM public.scheduled_transactions st
     JOIN conta c ON c.id = st.id WHERE st.status = 'paid'), 6);

-- =====================================================
-- SECAO 10b: quem deve e tem a receber do mesmo grupo compensa
-- =====================================================
-- Dezembro: o Helio paga o gas de R$ 1.000. O fechamento gera A receber de
-- R$ 500 para ele, e Pagamento de R$ 300 (Lais) e R$ 200 (Leticia). Ninguem
-- acerta. Janeiro: a Lais paga o mercado de R$ 600, e o fechamento gera
-- Pagamento de R$ 300 para o Helio, A receber de R$ 420 para a Lais e
-- Pagamento de R$ 120 para a Leticia.
--
-- Sem compensar, o Helio ficaria com R$ 500 a receber E R$ 300 a pagar, e
-- nenhum acerto fecharia isso (ele nao paga a si mesmo). Compensado:
--
--   Helio    A receber R$ 200 (dez)     Pagamento quitado (jan)
--   Lais     Pagamento quitado (dez)    A receber R$ 120 (jan)
--   Leticia  Pagamento R$ 200 (dez)     Pagamento R$ 120 (jan)
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, group_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0680000-0000-0000-0000-0000000000f4', 'a0680000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0680000-0000-0000-0000-0000000000d1', 'Gas', -1000.00, DATE '2026-12-15', 'expense'),
  ('a0680000-0000-0000-0000-0000000000f5', 'a0680000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0680000-0000-0000-0000-0000000000d1', 'Mercado de janeiro', -600.00, DATE '2027-01-15', 'expense');

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.sub = '';
SELECT public.registrar_fechamento_do_grupo(
  'a0680000-0000-0000-0000-0000000000d1', DATE '2026-12-10', DATE '2027-01-09', $json$
{ "total": 1000.00,
  "membros": [
    { "user_id": "a0680000-0000-0000-0000-0000000000a1", "percentual": 50, "pago": 1000.00, "acertos": 0, "responsabilidade": 500.00, "saldo": 500.00 },
    { "user_id": "a0680000-0000-0000-0000-0000000000b1", "percentual": 30, "pago": 0, "acertos": 0, "responsabilidade": 300.00, "saldo": -300.00 },
    { "user_id": "a0680000-0000-0000-0000-0000000000c1", "percentual": 20, "pago": 0, "acertos": 0, "responsabilidade": 200.00, "saldo": -200.00 }
  ],
  "itens": [
    { "kind": "despesa", "transaction_id": "a0680000-0000-0000-0000-0000000000f4", "from_user_id": "a0680000-0000-0000-0000-0000000000a1", "amount": 1000.00, "item_date": "2026-12-15", "description": "Gas" }
  ],
  "contas": [
    { "user_id": "a0680000-0000-0000-0000-0000000000a1", "tipo": "income", "valor": 500.00 },
    { "user_id": "a0680000-0000-0000-0000-0000000000b1", "tipo": "expense", "valor": 300.00 },
    { "user_id": "a0680000-0000-0000-0000-0000000000c1", "tipo": "expense", "valor": 200.00 }
  ] }
$json$::jsonb);
RESET ROLE;

SELECT pg_temp.expect('dezembro nao compensa nada: cada um so tem um lado em aberto',
  (SELECT count(*) FROM public.group_settlement_allocations
    WHERE group_id = 'a0680000-0000-0000-0000-0000000000d1' AND kind = 'compensacao'), 0);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.sub = '';
SELECT public.registrar_fechamento_do_grupo(
  'a0680000-0000-0000-0000-0000000000d1', DATE '2027-01-10', DATE '2027-02-09', $json$
{ "total": 600.00,
  "membros": [
    { "user_id": "a0680000-0000-0000-0000-0000000000a1", "percentual": 50, "pago": 0, "acertos": 0, "responsabilidade": 300.00, "saldo": -300.00 },
    { "user_id": "a0680000-0000-0000-0000-0000000000b1", "percentual": 30, "pago": 600.00, "acertos": 0, "responsabilidade": 180.00, "saldo": 420.00 },
    { "user_id": "a0680000-0000-0000-0000-0000000000c1", "percentual": 20, "pago": 0, "acertos": 0, "responsabilidade": 120.00, "saldo": -120.00 }
  ],
  "itens": [
    { "kind": "despesa", "transaction_id": "a0680000-0000-0000-0000-0000000000f5", "from_user_id": "a0680000-0000-0000-0000-0000000000b1", "amount": 600.00, "item_date": "2027-01-15", "description": "Mercado de janeiro" }
  ],
  "contas": [
    { "user_id": "a0680000-0000-0000-0000-0000000000a1", "tipo": "expense", "valor": 300.00 },
    { "user_id": "a0680000-0000-0000-0000-0000000000b1", "tipo": "income", "valor": 420.00 },
    { "user_id": "a0680000-0000-0000-0000-0000000000c1", "tipo": "expense", "valor": 120.00 }
  ] }
$json$::jsonb);
RESET ROLE;

INSERT INTO conta
SELECT CASE st.user_id
         WHEN 'a0680000-0000-0000-0000-0000000000a1' THEN 'helio' || to_char(c.period_end, 'MM')
         WHEN 'a0680000-0000-0000-0000-0000000000b1' THEN 'lais' || to_char(c.period_end, 'MM')
         WHEN 'a0680000-0000-0000-0000-0000000000c1' THEN 'leticia' || to_char(c.period_end, 'MM')
       END, st.id
  FROM public.scheduled_transactions st
  JOIN public.group_closings c ON c.id = st.group_closing_id
 WHERE c.group_id = 'a0680000-0000-0000-0000-0000000000d1'
   AND c.period_end IN (DATE '2027-01-09', DATE '2027-02-09');

SELECT pg_temp.expect_text('o Pagamento de janeiro do Helio esta quitado pela compensacao',
  pg_temp.status((SELECT id FROM conta WHERE quem = 'helio02')), 'paid');
SELECT pg_temp.expect_text('na data do fechamento de janeiro, sem lancamento',
  (SELECT paid_date::text || '/' || COALESCE(transaction_id::text, 'sem lancamento')
     FROM public.scheduled_transactions WHERE id = (SELECT id FROM conta WHERE quem = 'helio02')),
  '2027-02-09/sem lancamento');
SELECT pg_temp.expect_num('e o A receber de dezembro dele fica em R$ 200',
  pg_temp.aberto((SELECT id FROM conta WHERE quem = 'helio01')), 200.00);
SELECT pg_temp.expect_text('o Pagamento de dezembro da Lais esta quitado',
  pg_temp.status((SELECT id FROM conta WHERE quem = 'lais01')), 'paid');
SELECT pg_temp.expect_num('e o A receber de janeiro dela fica em R$ 120',
  pg_temp.aberto((SELECT id FROM conta WHERE quem = 'lais02')), 120.00);
-- Controle: a Leticia so tem contas a pagar. Nada compensa.
SELECT pg_temp.expect_num('a Leticia continua devendo R$ 200 de dezembro',
  pg_temp.aberto((SELECT id FROM conta WHERE quem = 'leticia01')), 200.00);
SELECT pg_temp.expect_num('e R$ 120 de janeiro',
  pg_temp.aberto((SELECT id FROM conta WHERE quem = 'leticia02')), 120.00);
SELECT pg_temp.expect('quatro linhas de compensacao, duas do Helio e duas da Lais',
  (SELECT count(*) FROM public.group_settlement_allocations
    WHERE group_id = 'a0680000-0000-0000-0000-0000000000d1' AND kind = 'compensacao'), 4);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000c1';
SELECT pg_temp.expect_num('em aberto, o que se recebe e o que se paga empatam',
  (SELECT SUM(CASE tipo WHEN 'income' THEN aberto ELSE -aberto END)
     FROM public.contas_em_aberto_do_grupo('a0680000-0000-0000-0000-0000000000d1')), 0);
SELECT pg_temp.expect('e ninguem tem os dois lados em aberto',
  (SELECT count(*) FROM (
     SELECT user_id FROM public.contas_em_aberto_do_grupo('a0680000-0000-0000-0000-0000000000d1')
      GROUP BY user_id HAVING count(DISTINCT tipo) > 1) x), 0);
RESET ROLE;

-- =====================================================
-- SECAO 11: o fechamento cuja conta ja foi quitada nao se apaga
-- =====================================================
-- Sem usuario (como numa colagem no SQL Editor): a trava da conta deixa
-- passar, e quem recusa e o CHECK -- o ON DELETE SET NULL deixaria uma conta
-- paga sem lancamento e sem fechamento.
SET LOCAL request.jwt.claim.sub = '';
SELECT pg_temp.expect_erro_com('apagar o fechamento ja quitado e recusado',
  $$DELETE FROM public.group_closings
     WHERE group_id = 'a0680000-0000-0000-0000-0000000000d1' AND period_end = DATE '2026-11-09'$$,
  'scheduled_transactions_paid_check');

-- =====================================================
-- SECAO 12: o grupo sem fechamento
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0680000-0000-0000-0000-0000000000b1';
INSERT INTO public.group_settlements
  (id, group_id, from_user_id, to_user_id, amount, settled_on, created_by)
VALUES
  ('a0680000-0000-0000-0000-000000000059', 'a0680000-0000-0000-0000-0000000000d2',
   'a0680000-0000-0000-0000-0000000000b1', 'a0680000-0000-0000-0000-0000000000e1',
   20.00, DATE '2026-11-15', 'a0680000-0000-0000-0000-0000000000b1');
RESET ROLE;

SELECT pg_temp.expect('o acerto do grupo sem fechamento fica registrado',
  (SELECT count(*) FROM public.group_settlements WHERE id = 'a0680000-0000-0000-0000-000000000059'), 1);
SELECT pg_temp.expect('e nao quita conta nenhuma, como antes da 068',
  (SELECT count(*) FROM public.group_settlement_allocations
    WHERE settlement_id = 'a0680000-0000-0000-0000-000000000059'), 0);

ROLLBACK;
