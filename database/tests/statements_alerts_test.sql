-- =====================================================
-- Teste do extrato, dos avisos e dos comprovantes (009)
-- =====================================================
-- Responde o que o 009 sozinho nao prova:
--   1. a deduplicacao do extrato e por CONTA: o mesmo fingerprint em contas
--      diferentes sao dois fatos, na mesma conta e um so;
--   2. o SINAL do extrato sobrevive: debito importado continua negativo, e
--      portanto continua sendo despesa nos quatro relatorios do 008;
--   3. a paridade status <-> transaction_id nao deixa uma linha ficar
--      'imported' sem lancamento -- invisivel para sempre sem nunca ter virado
--      dinheiro;
--   4. apagar o lancamento DEVOLVE a linha do extrato para 'pending' em vez de
--      quebrar o check ou deixar um ponteiro para o nada;
--   5. quem nunca abriu a tela de preferencias recebe aviso assim mesmo -- o
--      LEFT JOIN + COALESCE(3), e nao um INNER JOIN que zeraria a view;
--   6. `already_notified` vira true depois do aviso, e volta a false quando o
--      vencimento MUDA (adiar a conta e um fato novo);
--   7. a UNIQUE de bill_notifications impede mandar o mesmo aviso duas vezes;
--   8. um usuario enxerga o extrato de outro? o aviso de vencimento de outro?
--      o comprovante de outro? (bill_alerts e security_invoker);
--   9. o comprovante do acerto de grupo o grupo inteiro ve -- e so esse;
--  10. `anon` nao tem privilegio em nenhuma das seis tabelas novas.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 008 -> 009:
--   psql "$DB_URL" -f database/tests/statements_alerts_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_bool(label TEXT, got BOOLEAN, want BOOLEAN)
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
    RAISE NOTICE 'ok: % (barrado: %)', label, left(SQLERRM, 60);
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o comando PASSOU e deveria ter sido barrado', label;
END $$;

-- =====================================================
-- Fixture
-- =====================================================
--   servico     8730cd96-d656-4c48-863e-673e1016a832  (personal_finance)
--   Alimentacao b9db286c-ce4f-4fbe-b0bf-f3133185f90f  (despesa)
--   Salario     d93a6d01-3b70-4c54-af08-e8b56b09fb9e  (receita)

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a9', 'a@stmt.local'),
  ('bbbbbbbb-0000-0000-0000-0000000000b9', 'b@stmt.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a9', 'Usuario A', FALSE),
  ('bbbbbbbb-0000-0000-0000-0000000000b9', 'Usuario B', FALSE);

-- Duas contas do A (a deduplicacao e POR CONTA) e uma do B.
INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('c0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000a9', 'Corrente A', 'checking', 0),
  ('c0000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-0000000000a9', 'Poupanca A', 'savings', 0),
  ('c0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-0000000000b9', 'Corrente B', 'checking', 0);

-- Grupo com os dois: e o unico caminho pelo qual um comprovante do A pode ser
-- visto pelo B (o do acerto de contas do 007).
INSERT INTO public.expense_groups (id, name, created_by, group_code) VALUES
  ('60000000-0000-0000-0000-000000000009', 'Viagem', 'aaaaaaaa-0000-0000-0000-0000000000a9', 'STMT09');

-- O A entra sozinho: um trigger do 001 ja inscreve quem cria o grupo como
-- admin. Repetir o INSERT aqui esbarra em unique_user_per_group.
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('60000000-0000-0000-0000-000000000009', 'bbbbbbbb-0000-0000-0000-0000000000b9', 'member', 'active');

-- =====================================================
-- SECAO 1: deduplicacao do extrato
-- =====================================================
INSERT INTO public.statement_imports (id, user_id, account_id, file_name, file_format, period_start, period_end)
VALUES ('11110000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a9',
        'c0000000-0000-0000-0000-0000000000a1', 'setembro.ofx', 'ofx', '2026-09-01', '2026-09-30');

-- Dois cafes identicos no mesmo dia. O parser da #1 e #2, e os DOIS entram:
-- sao dois fatos, nao um repetido. Este e o falso positivo que o `#n` evita.
INSERT INTO public.statement_entries (import_id, user_id, account_id, fingerprint, posted_at, amount, description) VALUES
  ('11110000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a9',
   'c0000000-0000-0000-0000-0000000000a1', 'h:2026-09-03|-8.00|cafe|#1', '2026-09-03', -8.00, 'CAFE'),
  ('11110000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a9',
   'c0000000-0000-0000-0000-0000000000a1', 'h:2026-09-03|-8.00|cafe|#2', '2026-09-03', -8.00, 'CAFE'),
  ('11110000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a9',
   'c0000000-0000-0000-0000-0000000000a1', 'fitid:BANCO-77', '2026-09-10', -250.00, 'MERCADO'),
  ('11110000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a9',
   'c0000000-0000-0000-0000-0000000000a1', 'fitid:BANCO-78', '2026-09-05', 5000.00, 'SALARIO');

DO $$ BEGIN PERFORM pg_temp.expect('4 linhas entraram',
  (SELECT COUNT(*) FROM public.statement_entries WHERE import_id = '11110000-0000-0000-0000-000000000001'), 4); END $$;

-- Reimportar o MESMO arquivo: mesmos fingerprints, nenhuma linha nova.
INSERT INTO public.statement_imports (id, user_id, account_id, file_name, file_format)
VALUES ('11110000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000a9',
        'c0000000-0000-0000-0000-0000000000a1', 'setembro.ofx', 'ofx');

INSERT INTO public.statement_entries (import_id, user_id, account_id, fingerprint, posted_at, amount, description) VALUES
  ('11110000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000a9',
   'c0000000-0000-0000-0000-0000000000a1', 'fitid:BANCO-77', '2026-09-10', -250.00, 'MERCADO'),
  ('11110000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000a9',
   'c0000000-0000-0000-0000-0000000000a1', 'h:2026-09-03|-8.00|cafe|#1', '2026-09-03', -8.00, 'CAFE')
ON CONFLICT (account_id, fingerprint) DO NOTHING;

DO $$ BEGIN PERFORM pg_temp.expect('reimportar o mesmo arquivo nao duplica',
  (SELECT COUNT(*) FROM public.statement_entries WHERE account_id = 'c0000000-0000-0000-0000-0000000000a1'), 4); END $$;

-- O MESMO fingerprint em OUTRA conta entra: sao contas diferentes, fatos
-- diferentes. Se o indice fosse global, o extrato da poupanca perderia linhas.
INSERT INTO public.statement_imports (id, user_id, account_id, file_name, file_format)
VALUES ('11110000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-0000000000a9',
        'c0000000-0000-0000-0000-0000000000a2', 'poupanca.ofx', 'ofx');

INSERT INTO public.statement_entries (import_id, user_id, account_id, fingerprint, posted_at, amount, description)
VALUES ('11110000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-0000000000a9',
        'c0000000-0000-0000-0000-0000000000a2', 'fitid:BANCO-77', '2026-09-10', -250.00, 'MERCADO');

DO $$ BEGIN PERFORM pg_temp.expect('mesmo fingerprint em outra conta entra',
  (SELECT COUNT(*) FROM public.statement_entries WHERE account_id = 'c0000000-0000-0000-0000-0000000000a2'), 1); END $$;

-- =====================================================
-- SECAO 2: o SINAL, e a paridade status <-> transaction_id
-- =====================================================
DO $$ BEGIN PERFORM pg_temp.expect_num('debito importado continua NEGATIVO',
  (SELECT amount FROM public.statement_entries WHERE fingerprint = 'fitid:BANCO-77'
     AND account_id = 'c0000000-0000-0000-0000-0000000000a1'), -250.00); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_num('credito importado continua POSITIVO',
  (SELECT amount FROM public.statement_entries WHERE fingerprint = 'fitid:BANCO-78'), 5000.00); END $$;

-- Valor zero e linha de saldo lida errado, nao lancamento.
DO $$ BEGIN PERFORM pg_temp.expect_erro('extrato nao aceita valor zero', $q$
  INSERT INTO public.statement_entries (import_id, user_id, account_id, fingerprint, posted_at, amount, description)
  VALUES ('11110000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a9',
          'c0000000-0000-0000-0000-0000000000a1', 'h:zero', '2026-09-11', 0, 'SALDO')
$q$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_erro('nao da para marcar importado sem lancamento', $q$
  UPDATE public.statement_entries SET status = 'imported'
   WHERE fingerprint = 'fitid:BANCO-78'
$q$); END $$;

-- Importar de verdade: nasce a transacao e a linha aponta para ela. O
-- transaction_type vem do SINAL, exatamente como a rota faz.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type)
VALUES ('77770000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a9',
        '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
        'c0000000-0000-0000-0000-0000000000a1', 'MERCADO', -250.00, '2026-09-10', 'expense');

-- Com um lancamento que existe de verdade: o id preenchido numa linha
-- 'pending' tem que ser barrado. Com o subselect vazio de antes o valor era
-- NULL e o UPDATE passava -- a assercao nao mediria nada.
DO $$ BEGIN PERFORM pg_temp.expect_erro('nao da para deixar lancamento numa linha pendente', $q$
  UPDATE public.statement_entries
     SET transaction_id = '77770000-0000-0000-0000-000000000001'
   WHERE fingerprint = 'fitid:BANCO-78'
$q$); END $$;

UPDATE public.statement_entries
   SET status = 'imported', transaction_id = '77770000-0000-0000-0000-000000000001'
 WHERE fingerprint = 'fitid:BANCO-77' AND account_id = 'c0000000-0000-0000-0000-0000000000a1';

DO $$ BEGIN PERFORM pg_temp.expect('linha importada sai da fila de pendentes',
  (SELECT COUNT(*) FROM public.statement_entries
    WHERE account_id = 'c0000000-0000-0000-0000-0000000000a1' AND status = 'pending'), 3); END $$;

-- O 008 depende disto: se o sinal tivesse virado, o mercado apareceria como
-- receita e o mes fecharia positivo.
DO $$ BEGIN PERFORM pg_temp.expect_num('a despesa importada conta como despesa no 008',
  (SELECT expense FROM public.monthly_cash_flow
    WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a9' AND month = '2026-09-01'), 250.00); END $$;

-- =====================================================
-- SECAO 3: apagar o lancamento devolve a linha
-- =====================================================
DELETE FROM public.financial_transactions WHERE id = '77770000-0000-0000-0000-000000000001';

DO $$
DECLARE r RECORD;
BEGIN
  SELECT status, transaction_id INTO r FROM public.statement_entries
   WHERE fingerprint = 'fitid:BANCO-77' AND account_id = 'c0000000-0000-0000-0000-0000000000a1';
  PERFORM pg_temp.expect_text('linha volta para pending', r.status, 'pending');
  IF r.transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA: a linha ficou apontando para um lancamento que nao existe mais';
  END IF;
  RAISE NOTICE 'ok: ponteiro para o lancamento apagado foi limpo';
END $$;

-- =====================================================
-- SECAO 4: bill_alerts  (o aviso de vencimento)
-- =====================================================
-- O A NAO tem linha em notification_preferences. E o caso de todo mundo no dia
-- em que isto sobe -- e o caso que um INNER JOIN teria zerado em silencio.
INSERT INTO public.scheduled_transactions (id, user_id, category_id, account_id, description, amount, due_date, status) VALUES
  ('5c000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a9',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'c0000000-0000-0000-0000-0000000000a1',
   'Aluguel', 2500.00, CURRENT_DATE + 2, 'pending'),
  ('5c000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000a9',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'c0000000-0000-0000-0000-0000000000a1',
   'Luz', 180.00, CURRENT_DATE - 4, 'pending'),
  -- fora da janela de 3 dias: nao deve aparecer hoje
  ('5c000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-0000000000a9',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'c0000000-0000-0000-0000-0000000000a1',
   'Internet', 120.00, CURRENT_DATE + 20, 'pending');

DO $$ BEGIN PERFORM pg_temp.expect('sem preferencia salva, o default de 3 dias vale',
  (SELECT COUNT(*) FROM public.bill_alerts WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a9'), 2); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_text('a conta de daqui a 2 dias e due_soon',
  (SELECT kind FROM public.bill_alerts WHERE scheduled_transaction_id = '5c000000-0000-0000-0000-000000000001'), 'due_soon'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_text('a conta de 4 dias atras e overdue',
  (SELECT kind FROM public.bill_alerts WHERE scheduled_transaction_id = '5c000000-0000-0000-0000-000000000002'), 'overdue'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect('days_until conta os dias certos',
  (SELECT days_until FROM public.bill_alerts WHERE scheduled_transaction_id = '5c000000-0000-0000-0000-000000000001')::BIGINT, 2); END $$;

-- Abrindo a janela para 30 dias, a internet aparece.
INSERT INTO public.notification_preferences (user_id, days_before)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000a9', 30);

DO $$ BEGIN PERFORM pg_temp.expect('janela de 30 dias traz a internet',
  (SELECT COUNT(*) FROM public.bill_alerts WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a9'), 3); END $$;

-- Desligando o aviso de vencidas, a luz some e as duas a vencer ficam.
UPDATE public.notification_preferences SET notify_overdue = FALSE
 WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a9';

DO $$ BEGIN PERFORM pg_temp.expect('desligar vencidas tira so a vencida',
  (SELECT COUNT(*) FROM public.bill_alerts WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a9'), 2); END $$;

UPDATE public.notification_preferences SET notify_overdue = TRUE, days_before = 3
 WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a9';

-- Conta paga nao gera aviso. (O CHECK do 005 exige paid_date e transaction_id.)
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type)
VALUES ('77770000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000a9',
        '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
        'c0000000-0000-0000-0000-0000000000a1', 'Luz', -180.00, CURRENT_DATE, 'expense');

UPDATE public.scheduled_transactions
   SET status = 'paid', paid_date = CURRENT_DATE, transaction_id = '77770000-0000-0000-0000-000000000002'
 WHERE id = '5c000000-0000-0000-0000-000000000002';

DO $$ BEGIN PERFORM pg_temp.expect('conta paga sai do aviso',
  (SELECT COUNT(*) FROM public.bill_alerts WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a9'), 1); END $$;

-- =====================================================
-- SECAO 5: already_notified, e o adiamento
-- =====================================================
DO $$ BEGIN PERFORM pg_temp.expect_bool('antes de avisar, already_notified e false',
  (SELECT already_notified FROM public.bill_alerts WHERE scheduled_transaction_id = '5c000000-0000-0000-0000-000000000001'), FALSE); END $$;

INSERT INTO public.bill_notifications (user_id, scheduled_transaction_id, kind, reference_date, title, body)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000a9', '5c000000-0000-0000-0000-000000000001',
        'due_soon', CURRENT_DATE + 2, 'Aluguel vence em 2 dias', 'R$ 2.500,00');

DO $$ BEGIN PERFORM pg_temp.expect_bool('depois de avisar, already_notified e true',
  (SELECT already_notified FROM public.bill_alerts WHERE scheduled_transaction_id = '5c000000-0000-0000-0000-000000000001'), TRUE); END $$;

-- ESTA e a linha que impede o app de virar spam: o cron de amanha tenta de
-- novo e e barrado.
DO $$ BEGIN PERFORM pg_temp.expect_erro('o mesmo aviso nao sai duas vezes', $q$
  INSERT INTO public.bill_notifications (user_id, scheduled_transaction_id, kind, reference_date, title, body)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a9', '5c000000-0000-0000-0000-000000000001',
          'due_soon', CURRENT_DATE + 2, 'Aluguel vence em 2 dias', 'R$ 2.500,00')
$q$); END $$;

-- Adiar a conta e um fato novo: o aviso volta a ser devido.
UPDATE public.scheduled_transactions SET due_date = CURRENT_DATE + 1
 WHERE id = '5c000000-0000-0000-0000-000000000001';

DO $$ BEGIN PERFORM pg_temp.expect_bool('adiar a conta volta a merecer aviso',
  (SELECT already_notified FROM public.bill_alerts WHERE scheduled_transaction_id = '5c000000-0000-0000-0000-000000000001'), FALSE); END $$;

-- =====================================================
-- SECAO 6: receipts
-- =====================================================
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type)
VALUES ('77770000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-0000000000a9',
        '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
        'c0000000-0000-0000-0000-0000000000a1', 'Hotel', -900.00, CURRENT_DATE, 'expense');

INSERT INTO public.group_settlements (id, group_id, from_user_id, to_user_id, amount, created_by)
VALUES ('5e000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000009',
        'aaaaaaaa-0000-0000-0000-0000000000a9', 'bbbbbbbb-0000-0000-0000-0000000000b9', 450.00,
        'aaaaaaaa-0000-0000-0000-0000000000a9');

INSERT INTO public.receipts (user_id, transaction_id, storage_path, file_name, mime_type, byte_size)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000a9', '77770000-0000-0000-0000-000000000003',
        'aaaaaaaa-0000-0000-0000-0000000000a9/nota.pdf', 'nota.pdf', 'application/pdf', 120000);

INSERT INTO public.receipts (user_id, settlement_id, storage_path, file_name, mime_type, byte_size)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000a9', '5e000000-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-0000000000a9/pix.png', 'pix.png', 'image/png', 80000);

DO $$ BEGIN PERFORM pg_temp.expect_erro('comprovante solto nao entra', $q$
  INSERT INTO public.receipts (user_id, storage_path, file_name, mime_type, byte_size)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-0000000000a9/solto.pdf',
          'solto.pdf', 'application/pdf', 1000)
$q$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_erro('comprovante em dois alvos nao entra', $q$
  INSERT INTO public.receipts (user_id, transaction_id, settlement_id, storage_path, file_name, mime_type, byte_size)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a9', '77770000-0000-0000-0000-000000000003',
          '5e000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000a9/dois.pdf',
          'dois.pdf', 'application/pdf', 1000)
$q$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_erro('arquivo de 11 MB nao entra', $q$
  INSERT INTO public.receipts (user_id, transaction_id, storage_path, file_name, mime_type, byte_size)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a9', '77770000-0000-0000-0000-000000000003',
          'aaaaaaaa-0000-0000-0000-0000000000a9/grande.pdf', 'grande.pdf', 'application/pdf', 11534336)
$q$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_erro('executavel disfarcado de comprovante nao entra', $q$
  INSERT INTO public.receipts (user_id, transaction_id, storage_path, file_name, mime_type, byte_size)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a9', '77770000-0000-0000-0000-000000000003',
          'aaaaaaaa-0000-0000-0000-0000000000a9/x.exe', 'x.exe', 'application/x-msdownload', 1000)
$q$); END $$;

-- =====================================================
-- SECAO 7: um usuario NAO enxerga o do outro
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-0000000000b9';

DO $$ BEGIN PERFORM pg_temp.expect('B nao ve o extrato do A',
  (SELECT COUNT(*) FROM public.statement_entries), 0); END $$;

DO $$ BEGIN PERFORM pg_temp.expect('B nao ve os imports do A',
  (SELECT COUNT(*) FROM public.statement_imports), 0); END $$;

DO $$ BEGIN PERFORM pg_temp.expect('B nao ve o que vence na conta do A',
  (SELECT COUNT(*) FROM public.bill_alerts), 0); END $$;

DO $$ BEGIN PERFORM pg_temp.expect('B nao ve os avisos do A',
  (SELECT COUNT(*) FROM public.bill_notifications), 0); END $$;

DO $$ BEGIN PERFORM pg_temp.expect('B nao ve a preferencia do A',
  (SELECT COUNT(*) FROM public.notification_preferences), 0); END $$;

-- O comprovante do ACERTO o grupo ve (e a prova do pagamento); o do lancamento
-- pessoal, nao.
DO $$ BEGIN PERFORM pg_temp.expect('B ve so o comprovante do acerto do grupo',
  (SELECT COUNT(*) FROM public.receipts), 1); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_text('e e o do acerto, nao o do hotel',
  (SELECT file_name FROM public.receipts), 'pix.png'); END $$;

-- B nao pode escrever no extrato do A nem se souber o id da conta.
DO $$ BEGIN PERFORM pg_temp.expect_erro('B nao consegue inserir extrato em nome do A', $q$
  INSERT INTO public.statement_imports (user_id, account_id, file_name, file_format)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a9', 'c0000000-0000-0000-0000-0000000000a1', 'falso.ofx', 'ofx')
$q$); END $$;

-- Nada no navegador deveria poder fabricar um aviso de vencimento.
DO $$ BEGIN PERFORM pg_temp.expect_erro('ninguem logado fabrica um aviso', $q$
  INSERT INTO public.bill_notifications (user_id, scheduled_transaction_id, kind, reference_date, title, body)
  VALUES ('bbbbbbbb-0000-0000-0000-0000000000b9', '5c000000-0000-0000-0000-000000000001',
          'due_soon', CURRENT_DATE, 'falso', 'falso')
$q$); END $$;

RESET ROLE;
RESET request.jwt.claim.sub;

-- =====================================================
-- SECAO 8: anon nao tem privilegio nenhum
-- =====================================================
DO $$
DECLARE v_tab TEXT; v_tem BOOLEAN;
BEGIN
  FOREACH v_tab IN ARRAY ARRAY['statement_imports', 'statement_entries', 'notification_preferences',
                               'push_subscriptions', 'bill_notifications', 'receipts', 'bill_alerts']
  LOOP
    SELECT bool_or(has_table_privilege('anon', 'public.' || v_tab, p))
      INTO v_tem
      FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p;

    IF v_tem THEN
      RAISE EXCEPTION 'FALHA: anon tem privilegio em public.% -- a chave anon vai no bundle JS publico', v_tab;
    END IF;
  END LOOP;
  RAISE NOTICE 'ok: anon sem privilegio nas 7 relacoes novas';
END $$;

-- =====================================================
-- SECAO 9: CONTROLE NEGATIVO de security_invoker
-- =====================================================
-- Prova que a assercao "B nao ve o que vence na conta do A" mede a flag, e nao
-- uma view vazia ou uma fixture errada.
ALTER VIEW public.bill_alerts SET (security_invoker = false);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-0000000000b9';

DO $$
DECLARE v_vazou BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_vazou FROM public.bill_alerts
   WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a9';

  IF v_vazou = 0 THEN
    RAISE EXCEPTION 'FALHA (controle negativo): sem security_invoker o B continuou sem ver o vencimento do A. A assercao da SECAO 7 nao esta medindo a flag.';
  END IF;
  RAISE NOTICE 'ok: controle negativo de security_invoker (sem a flag vazariam % linhas)', v_vazou;
END $$;

RESET ROLE;
RESET request.jwt.claim.sub;

ALTER VIEW public.bill_alerts SET (security_invoker = true);

-- =====================================================
-- SECAO 10: CONTROLE NEGATIVO da deduplicacao
-- =====================================================
-- Sem o indice unico, reimportar o mesmo arquivo duplica o extrato. Se o
-- INSERT repetido NAO passar aqui, e porque a SECAO 1 estava verde por outro
-- motivo.
DROP INDEX public.idx_statement_entries_fingerprint;

INSERT INTO public.statement_entries (import_id, user_id, account_id, fingerprint, posted_at, amount, description)
VALUES ('11110000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000a9',
        'c0000000-0000-0000-0000-0000000000a1', 'fitid:BANCO-78', '2026-09-05', 5000.00, 'SALARIO');

DO $$
DECLARE v_n BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_n FROM public.statement_entries
   WHERE account_id = 'c0000000-0000-0000-0000-0000000000a1' AND fingerprint = 'fitid:BANCO-78';

  IF v_n < 2 THEN
    RAISE EXCEPTION 'FALHA (controle negativo): sem o indice unico o duplicado NAO entrou. A SECAO 1 nao esta medindo a deduplicacao.';
  END IF;
  RAISE NOTICE 'ok: controle negativo da deduplicacao (sem o indice virariam % linhas)', v_n;
END $$;

-- Desfaz o duplicado proposital e recria o indice IGUAL ao do 009. Um indice
-- recriado com outra definicao para "caber" no estado sujo provaria que o
-- controle negativo ficou de pe -- exatamente o contrario do que ele existe
-- para provar. O ROLLBACK do fim tambem desfaria tudo, mas ai a ultima
-- assercao do arquivo seria um estado que o 009 nao produz.
DELETE FROM public.statement_entries a
 USING public.statement_entries b
 WHERE a.ctid > b.ctid
   AND a.account_id = b.account_id
   AND a.fingerprint = b.fingerprint;

CREATE UNIQUE INDEX idx_statement_entries_fingerprint
  ON public.statement_entries(account_id, fingerprint);

-- =====================================================
-- Fim
-- =====================================================
DO $$ BEGIN RAISE NOTICE '=== extrato, avisos e comprovantes: todas as assercoes passaram ==='; END $$;

ROLLBACK;
