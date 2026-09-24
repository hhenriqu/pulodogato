-- =====================================================
-- Teste do aviso de assinatura (016 / HMO-148)
-- =====================================================
-- Esta issue existe por UM motivo: o usuario nao pode ser avisado duas vezes
-- do mesmo alerta. A varredura roda no cron diario e ao fim de cada importacao
-- de extrato, entao "grava o aviso" sem deduplicacao = tres pushes iguais numa
-- tarde. Todo assert daqui serve a esse fim.
--
-- O que se prova:
--   1. o ON CONFLICT que a rota /api/cron/recurrence-alerts realmente manda
--      RESOLVE contra o indice do 016 -- o assert mais importante do arquivo,
--      ver a secao 1;
--   2. rodar a varredura de novo NAO gera aviso novo;
--   3. uma cobranca nova (reference_date novo) GERA aviso novo -- controle
--      negativo da deduplicacao: sem ele, um indice errado que barra tudo
--      passaria verde nos itens 1 e 2;
--   4. os dois CHECKs barram o aviso orfao, o de duas referencias e o `kind`
--      apontando para a familia errada;
--   5. a familia de conta prevista continua deduplicando, e duas contas
--      diferentes no mesmo dia continuam cabendo (NULL nao colide com NULL);
--   6. apagar a recorrencia apaga o aviso (o clique do sino nunca fica sem
--      destino);
--   7. a RLS nao deixa o aviso de assinatura de um usuario aparecer no sino do
--      outro -- familia nova de linhas na mesma tabela, mesma pergunta.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 016:
--   psql "$DB_URL" -f database/tests/recurrence_notifications_test.sql
--
-- Qualquer FALHA lanca excecao e aborta.
--
-- POR QUE ESTE TESTE E EM SQL
-- ---------------------------
-- scripts/test-recurrence-alerts.mjs prova o TypeScript: que texto sai, que
-- linha e montada, e quem fica de fora. O que ele nao alcanca e se o banco
-- ACEITA aquela linha e se o `onConflict` daquele upsert encontra um arbitro.
-- Essa juncao e onde o desenho original desta issue estava errado (pedia um
-- indice unico PARCIAL, que o PostgREST nao consegue usar como arbitro), e
-- nenhum teste de TypeScript com o cliente dublado teria pegado isso.
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

CREATE OR REPLACE FUNCTION pg_temp.expect_text(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- Espera que um comando quebre. Sem isto, um CHECK que parou de valer deixaria
-- o teste verde: o INSERT proibido passaria e ninguem contaria as linhas.
CREATE OR REPLACE FUNCTION pg_temp.expect_erro(label TEXT, sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ok: % (barrado: %)', label, left(SQLERRM, 70);
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o comando PASSOU e deveria ter sido barrado', label;
END $$;

-- Espera que um comando PASSE. Usado na secao 1: o interesse ali nao e o
-- resultado, e sim o comando nao morrer com "no unique or exclusion constraint
-- matching the ON CONFLICT specification".
CREATE OR REPLACE FUNCTION pg_temp.expect_ok(label TEXT, sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RAISE NOTICE 'ok: %', label;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FALHA: % -> o comando foi barrado: %', label, SQLERRM;
END $$;

-- =====================================================
-- Fixture
-- =====================================================
--   servico     8730cd96-d656-4c48-863e-673e1016a832  (personal_finance)
--   Alimentacao b9db286c-ce4f-4fbe-b0bf-f3133185f90f  (despesa)
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000c1', 'a@rec.local'),
  ('bbbbbbbb-0000-0000-0000-0000000000c2', 'b@rec.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000c1', 'Usuario A', FALSE),
  ('bbbbbbbb-0000-0000-0000-0000000000c2', 'Usuario B', FALSE);

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('c1000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'Corrente A', 'checking', 0);

-- Duas assinaturas do A e uma do B. A do B existe para a secao 7.
INSERT INTO public.detected_recurrences
  (id, user_id, merchant_key, display_name, avg_amount, last_amount, monthly_cost,
   frequency, occurrences, last_charge_date, next_expected_date)
VALUES
  ('d1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000c1',
   'netflix', 'Netflix', 39.90, 44.90, 44.90, 'MONTHLY', 4,
   DATE '2026-09-10', DATE '2026-10-10'),
  ('d1000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000c1',
   'spotify', 'Spotify', 21.90, 21.90, 21.90, 'MONTHLY', 5,
   DATE '2026-09-05', DATE '2026-10-05'),
  ('d1000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-0000000000c2',
   'netflix', 'Netflix', 39.90, 59.90, 59.90, 'MONTHLY', 3,
   DATE '2026-09-12', DATE '2026-10-12');

-- Duas contas previstas, para a secao 5.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, description, amount, due_date, status)
VALUES
  ('5c100000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000c1',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'c1000000-0000-0000-0000-0000000000a1',
   'Aluguel', 2500.00, CURRENT_DATE + 2, 'pending'),
  ('5c100000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000c1',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'c1000000-0000-0000-0000-0000000000a1',
   'Internet', 120.00, CURRENT_DATE + 2, 'pending');

-- =====================================================
-- SECAO 1: o upsert da rota encontra um arbitro
-- =====================================================
-- ESTE e o assert que justifica o arquivo existir.
--
-- O desenho da HMO-148 pedia um indice unico PARCIAL
-- (... WHERE recurrence_id IS NOT NULL). O raciocinio estava certo, a forma
-- nao: o Postgres so infere um indice parcial como arbitro de ON CONFLICT se a
-- propria clausula repetir o predicado do indice, e o `onConflict:` do
-- supabase-js/PostgREST so sabe mandar uma lista de colunas. Com o indice
-- parcial, este comando -- que e exatamente o que a rota manda -- responderia
--
--   ERROR: there is no unique or exclusion constraint matching the ON CONFLICT
--          specification
--
-- em TODA execucao do cron, e ninguem receberia aviso nenhum.
--
-- O teste e escrito com a lista de colunas NUA, sem WHERE, de proposito: e
-- assim que o PostgREST monta, e e essa forma que tem que continuar valendo.
-- Trocar o indice do 016 por um parcial reprova aqui.
DO $$ BEGIN PERFORM pg_temp.expect_ok(
  'o ON CONFLICT da rota (lista de colunas, sem WHERE) resolve contra o indice do 016', $q$
  INSERT INTO public.bill_notifications
    (user_id, recurrence_id, kind, reference_date, title, body)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-000000000001',
          'price_increase', DATE '2026-09-10',
          'Netflix subiu de preço', 'Netflix subiu 12,5% (de R$ 39,90 para R$ 44,90).')
  ON CONFLICT (recurrence_id, kind, reference_date) DO NOTHING
$q$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect('o aviso entrou',
  (SELECT count(*) FROM public.bill_notifications
    WHERE recurrence_id = 'd1000000-0000-0000-0000-000000000001'), 1); END $$;

-- =====================================================
-- SECAO 2: a varredura de novo nao avisa de novo
-- =====================================================
-- Tres tentativas: o cron de amanha, a importacao de extrato da tarde, e o
-- botao "Procurar agora". Nenhuma pode gerar linha nova.
INSERT INTO public.bill_notifications
  (user_id, recurrence_id, kind, reference_date, title, body)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-000000000001',
        'price_increase', DATE '2026-09-10', 'Netflix subiu de preço', 'texto diferente'),
       ('aaaaaaaa-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-000000000001',
        'price_increase', DATE '2026-09-10', 'outro titulo', 'outro corpo')
ON CONFLICT (recurrence_id, kind, reference_date) DO NOTHING;

DO $$ BEGIN PERFORM pg_temp.expect('varrer de novo nao gera aviso novo',
  (SELECT count(*) FROM public.bill_notifications
    WHERE recurrence_id = 'd1000000-0000-0000-0000-000000000001'), 1); END $$;

-- O texto e o de quem chegou PRIMEIRO: ignoreDuplicates nao sobrescreve. Isto
-- esta afirmado porque e o contrario do default do upsert, e alguem que trocar
-- `ignoreDuplicates: true` por `false` na rota muda o comportamento aqui --
-- reescrevendo um aviso que o usuario talvez ja tenha lido no celular.
DO $$ BEGIN PERFORM pg_temp.expect_text('o texto do primeiro aviso nao e reescrito',
  (SELECT body FROM public.bill_notifications
    WHERE recurrence_id = 'd1000000-0000-0000-0000-000000000001'),
  'Netflix subiu 12,5% (de R$ 39,90 para R$ 44,90).'); END $$;

-- Sem ON CONFLICT, o indice tem que BARRAR de verdade. Se o `onConflict:` da
-- rota for escrito com um nome de coluna errado, o cliente manda o INSERT sem
-- arbitro nenhum -- e o que impede o spam passa a ser so este indice.
DO $$ BEGIN PERFORM pg_temp.expect_erro('sem ON CONFLICT, o indice barra o aviso repetido', $q$
  INSERT INTO public.bill_notifications
    (user_id, recurrence_id, kind, reference_date, title, body)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-000000000001',
          'price_increase', DATE '2026-09-10', 'Netflix subiu de preço', 'x')
$q$); END $$;

-- =====================================================
-- SECAO 3: controle negativo -- um FATO NOVO merece aviso novo
-- =====================================================
-- Sem esta secao, um indice unico em (recurrence_id, kind) -- sem a data --
-- passaria nas secoes 1 e 2 e o usuario seria avisado do aumento UMA VEZ na
-- vida daquela assinatura: o reajuste do ano seguinte passaria calado, e nao
-- haveria sintoma nenhum.
INSERT INTO public.bill_notifications
  (user_id, recurrence_id, kind, reference_date, title, body)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-000000000001',
        'price_increase', DATE '2026-10-10', 'Netflix subiu de preço', 'reajuste seguinte')
ON CONFLICT (recurrence_id, kind, reference_date) DO NOTHING;

DO $$ BEGIN PERFORM pg_temp.expect('cobranca nova (reference_date novo) gera aviso novo',
  (SELECT count(*) FROM public.bill_notifications
    WHERE recurrence_id = 'd1000000-0000-0000-0000-000000000001'), 2); END $$;

-- E o outro alerta da MESMA assinatura na MESMA data e outro aviso: os dois
-- dizem coisas diferentes e os dois tem que chegar.
INSERT INTO public.bill_notifications
  (user_id, recurrence_id, kind, reference_date, title, body)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-000000000001',
        'charge_after_cancel', DATE '2026-09-10',
        'Netflix cobrou depois de cancelada', 'cobrou R$ 44,90 em 10/09/2026.')
ON CONFLICT (recurrence_id, kind, reference_date) DO NOTHING;

DO $$ BEGIN PERFORM pg_temp.expect('o outro kind na mesma data e um aviso separado',
  (SELECT count(*) FROM public.bill_notifications
    WHERE recurrence_id = 'd1000000-0000-0000-0000-000000000001'), 3); END $$;

-- =====================================================
-- SECAO 4: o que o banco tem que RECUSAR
-- =====================================================
DO $$ BEGIN PERFORM pg_temp.expect_erro('aviso sem referencia nenhuma (orfao no sino)', $q$
  INSERT INTO public.bill_notifications (user_id, kind, reference_date, title, body)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'price_increase', DATE '2026-09-10', 't', 'b')
$q$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_erro('aviso com as DUAS referencias', $q$
  INSERT INTO public.bill_notifications
    (user_id, scheduled_transaction_id, recurrence_id, kind, reference_date, title, body)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', '5c100000-0000-0000-0000-000000000001',
          'd1000000-0000-0000-0000-000000000002', 'price_increase', DATE '2026-09-05', 't', 'b')
$q$); END $$;

-- Este e o caso que o CHECK de exclusividade sozinho aceitaria. A linha
-- nasceria valida, entraria no sino, e sairia do `already_notified` da view
-- bill_alerts (que casa por scheduled_transaction_id) -- o aviso de vencimento
-- do aluguel sairia DE NOVO amanha.
DO $$ BEGIN PERFORM pg_temp.expect_erro('kind de conta prevista apontando para recorrencia', $q$
  INSERT INTO public.bill_notifications
    (user_id, recurrence_id, kind, reference_date, title, body)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-000000000002',
          'due_soon', DATE '2026-09-05', 't', 'b')
$q$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_erro('kind de recorrencia apontando para conta prevista', $q$
  INSERT INTO public.bill_notifications
    (user_id, scheduled_transaction_id, kind, reference_date, title, body)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', '5c100000-0000-0000-0000-000000000001',
          'charge_after_cancel', CURRENT_DATE + 2, 't', 'b')
$q$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_erro('kind fora do dominio', $q$
  INSERT INTO public.bill_notifications
    (user_id, recurrence_id, kind, reference_date, title, body)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-000000000002',
          'preco_subiu', DATE '2026-09-05', 't', 'b')
$q$); END $$;

-- =====================================================
-- SECAO 5: a familia de conta prevista nao foi afetada
-- =====================================================
-- O 016 mexeu na tabela que o aviso de vencimento usa. O que nao pode ter
-- mudado: a deduplicacao daquela familia, e a possibilidade de duas contas
-- DIFERENTES vencerem no mesmo dia (o que, com a coluna nova no indice, so
-- funciona porque NULL nao colide com NULL).
INSERT INTO public.bill_notifications
  (user_id, scheduled_transaction_id, kind, reference_date, title, body)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', '5c100000-0000-0000-0000-000000000001',
        'due_soon', CURRENT_DATE + 2, 'Aluguel vence em 2 dias', 'R$ 2.500,00');

DO $$ BEGIN PERFORM pg_temp.expect_erro('aviso de vencimento continua sem repetir', $q$
  INSERT INTO public.bill_notifications
    (user_id, scheduled_transaction_id, kind, reference_date, title, body)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', '5c100000-0000-0000-0000-000000000001',
          'due_soon', CURRENT_DATE + 2, 'Aluguel vence em 2 dias', 'R$ 2.500,00')
$q$); END $$;

-- Duas contas diferentes, mesmo kind, mesmo dia: as duas cabem. Se o indice
-- novo tratasse NULL como um valor, esta linha seria barrada e o usuario
-- receberia aviso de UMA das contas que vencem hoje.
INSERT INTO public.bill_notifications
  (user_id, scheduled_transaction_id, kind, reference_date, title, body)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', '5c100000-0000-0000-0000-000000000002',
        'due_soon', CURRENT_DATE + 2, 'Internet vence em 2 dias', 'R$ 120,00');

DO $$ BEGIN PERFORM pg_temp.expect('duas contas vencendo no mesmo dia geram dois avisos',
  (SELECT count(*) FROM public.bill_notifications
    WHERE scheduled_transaction_id IS NOT NULL AND kind = 'due_soon'), 2); END $$;

-- E o `already_notified` da view do 009 continua respondendo certo com as
-- linhas de recorrencia na mesma tabela.
DO $$ BEGIN PERFORM pg_temp.expect('a view bill_alerts ainda ve o aviso ja emitido',
  (SELECT count(*) FROM public.bill_alerts
    WHERE scheduled_transaction_id = '5c100000-0000-0000-0000-000000000001'
      AND already_notified), 1); END $$;

-- =====================================================
-- SECAO 6: apagar a assinatura apaga o aviso
-- =====================================================
-- Sem o CASCADE o item continua no sino e o clique abre uma tela vazia.
DELETE FROM public.detected_recurrences WHERE id = 'd1000000-0000-0000-0000-000000000001';

DO $$ BEGIN PERFORM pg_temp.expect('apagar a assinatura levou os 3 avisos dela',
  (SELECT count(*) FROM public.bill_notifications
    WHERE recurrence_id = 'd1000000-0000-0000-0000-000000000001'), 0); END $$;

-- =====================================================
-- SECAO 7: o sino de um nao mostra a assinatura do outro
-- =====================================================
-- Familia nova de linhas na mesma tabela, mesma pergunta da HMO-121. A policy
-- do 009 e por user_id e deveria cobrir, mas "deveria cobrir" e o que se
-- verifica aqui: um aviso gravado pelo cron com service_role entra sem passar
-- por policy nenhuma, e um `user_id` errado no payload da rota vira vazamento.
INSERT INTO public.bill_notifications
  (user_id, recurrence_id, kind, reference_date, title, body)
VALUES ('bbbbbbbb-0000-0000-0000-0000000000c2', 'd1000000-0000-0000-0000-0000000000b1',
        'price_increase', DATE '2026-09-12', 'Netflix subiu de preço', 'do B');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-0000-0000-0000000000c1"}';

DO $$ BEGIN PERFORM pg_temp.expect('o A nao ve o aviso de assinatura do B',
  (SELECT count(*) FROM public.bill_notifications
    WHERE recurrence_id = 'd1000000-0000-0000-0000-0000000000b1'), 0); END $$;

-- Os dois avisos de vencimento do A. Os tres de assinatura dele morreram no
-- CASCADE da secao 6; o do B esta invisivel, nao ausente.
DO $$ BEGIN PERFORM pg_temp.expect('o A continua vendo os proprios avisos',
  (SELECT count(*) FROM public.bill_notifications), 2); END $$;

RESET ROLE;

ROLLBACK;
