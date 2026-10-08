-- =====================================================
-- Teste do aviso por e-mail (047)
-- =====================================================
-- HMO-183. Roda no db-verify, contra o banco que as migrations constroem do
-- zero, DEPOIS da 047 -- a posicao importa: rodando antes, toda assercao sobre
-- a view veria a definicao do 009 e o arquivo passaria verde sem exercitar
-- nada do que a 047 acrescenta.
--
-- O QUE ESTE ARQUIVO PRENDE
-- -------------------------
-- Quatro defeitos, todos silenciosos:
--
--   1. RODAR O CRON DUAS VEZES MANDA DOIS E-MAILS. A unica coisa entre o app e
--      o spam diario e a UNIQUE (scheduled_transaction_id, kind,
--      reference_date) do 009: ela faz o upsert devolver lista VAZIA na
--      segunda execucao, e e sobre essa lista que o e-mail sai. A SECAO 2 roda
--      o ciclo do cron duas vezes e exige 1 linha e 0 recem-gravados.
--
--   2. A VIEW PERDE O security_invoker. `CREATE OR REPLACE VIEW` APAGA os
--      reloptions, e a 047 recria `bill_alerts`. Sem o ALTER VIEW de volta, a
--      view roda como o DONO, a RLS de scheduled_transactions deixa de valer,
--      e o sino de cada usuario lista as contas de todo mundo -- com numeros
--      plausiveis e nenhum erro. A SECAO 3 le `reloptions` direto do catalogo.
--
--   3. DESLIGAR O E-MAIL APAGA A CONTA DO SINO. `notify_email` e preferencia
--      de CANAL. Se ela entrar no WHERE da view, quem desligar o e-mail perde
--      tambem o aviso dentro do app -- que e o canal que sempre funcionou. A
--      SECAO 4 exige a linha presente com notify_email = false.
--
--   4. "E-MAIL ENVIADO" SEM COMO CONFERIR. `emailed_at` sem `email_message_id`
--      e uma linha que afirma a entrega e nao sustenta: sem o id nao da para
--      achar a mensagem no painel do provedor. A SECAO 5 exige que o CHECK
--      recuse as duas metades.
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

CREATE OR REPLACE FUNCTION pg_temp.expect_bool(label TEXT, got BOOLEAN, want BOOLEAN)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- =====================================================
-- Fixture
-- =====================================================
-- Duas pessoas, uma conta a vencer cada. A Dora DESLIGA o e-mail; o Eli nunca
-- abriu a tela de preferencias e por isso nao tem linha nenhuma em
-- notification_preferences -- que e o estado de TODO MUNDO em producao hoje,
-- e o unico em que o COALESCE da view e exercitado.

INSERT INTO auth.users (id, email) VALUES
  ('d3000000-0000-0000-0000-0000000000d1', 'dora-183@teste.local'),
  ('d3000000-0000-0000-0000-0000000000e1', 'eli-183@teste.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('d3000000-0000-0000-0000-0000000000d1', 'Dora 183', FALSE),
  ('d3000000-0000-0000-0000-0000000000e1', 'Eli 183',  FALSE);

-- A Dora tem linha e desligou SO o e-mail: os outros dois canais continuam
-- ligados. E essa combinacao que distingue "preferencia de canal" de
-- "preferencia de aviso".
INSERT INTO public.notification_preferences (user_id, days_before, notify_due_soon, notify_overdue, notify_email)
VALUES ('d3000000-0000-0000-0000-0000000000d1', 3, TRUE, TRUE, FALSE);

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('fd000000-0000-0000-0000-0000000000d1', 'd3000000-0000-0000-0000-0000000000d1', 'Conta Dora', 'checking', 1000),
  ('fd000000-0000-0000-0000-0000000000e1', 'd3000000-0000-0000-0000-0000000000e1', 'Conta Eli',  'checking', 1000);

-- Vencem AMANHA: dentro da janela de 3 dias dos dois (o Eli pelo COALESCE).
-- `amount` POSITIVO porque scheduled_transactions tem CHECK (amount > 0) -- a
-- direcao mora na regra, nao no sinal.
INSERT INTO public.scheduled_transactions
  (id, user_id, account_id, category_id, description, amount, due_date, status)
SELECT 'ad000000-0000-0000-0000-0000000000d1',
       'd3000000-0000-0000-0000-0000000000d1',
       'fd000000-0000-0000-0000-0000000000d1',
       c.id, 'Aluguel Dora', 1850.50, CURRENT_DATE + 1, 'pending'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

INSERT INTO public.scheduled_transactions
  (id, user_id, account_id, category_id, description, amount, due_date, status)
SELECT 'ad000000-0000-0000-0000-0000000000e1',
       'd3000000-0000-0000-0000-0000000000e1',
       'fd000000-0000-0000-0000-0000000000e1',
       c.id, 'Luz Eli', 210.00, CURRENT_DATE + 1, 'pending'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

-- =====================================================
-- SECAO 1: a coluna e o default
-- =====================================================

SELECT pg_temp.expect(
  'notify_email existe em notification_preferences',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_preferences'
      AND column_name = 'notify_email'),
  1);

-- Linha nova sem dizer nada sobre e-mail tem que nascer LIGADA. Um default
-- `false` aqui faria o canal nascer desligado para quem salvar a preferencia
-- de dias pela tela -- o mesmo silencio do push.
INSERT INTO public.notification_preferences (user_id, days_before)
VALUES ('d3000000-0000-0000-0000-0000000000e1', 5);

SELECT pg_temp.expect_bool(
  'linha nova nasce com notify_email = true',
  (SELECT notify_email FROM public.notification_preferences
    WHERE user_id = 'd3000000-0000-0000-0000-0000000000e1'),
  TRUE);

-- Volta ao estado "nunca abriu a tela", que e o que a SECAO 4 precisa para
-- exercitar o COALESCE da view.
DELETE FROM public.notification_preferences
 WHERE user_id = 'd3000000-0000-0000-0000-0000000000e1';

-- =====================================================
-- SECAO 2: rodar o cron duas vezes nao gera dois e-mails
-- =====================================================
-- Isto reproduz o ciclo EXATO da rota: le bill_alerts com already_notified =
-- false, e faz UM upsert com ON CONFLICT DO NOTHING. O que a rota manda por
-- e-mail e so o que o upsert DEVOLVE.

-- Primeira execucao do dia.
CREATE TEMP TABLE primeira_execucao AS
WITH gravados AS (
  INSERT INTO public.bill_notifications
    (user_id, scheduled_transaction_id, kind, reference_date, title, body, channel)
  SELECT a.user_id, a.scheduled_transaction_id, a.kind, a.due_date,
         a.description || ' vence amanhã', 'R$ ' || a.amount, 'inapp'
    FROM public.bill_alerts a
   WHERE a.already_notified = FALSE
  ON CONFLICT (scheduled_transaction_id, kind, reference_date) DO NOTHING
  RETURNING id, user_id
)
SELECT * FROM gravados;

SELECT pg_temp.expect(
  '1a execucao grava os dois avisos',
  (SELECT count(*) FROM primeira_execucao), 2);

-- Segunda execucao, no mesmo dia. Esta e a assercao que a issue pede.
CREATE TEMP TABLE segunda_execucao AS
WITH gravados AS (
  INSERT INTO public.bill_notifications
    (user_id, scheduled_transaction_id, kind, reference_date, title, body, channel)
  SELECT a.user_id, a.scheduled_transaction_id, a.kind, a.due_date,
         a.description || ' vence amanhã', 'R$ ' || a.amount, 'inapp'
    FROM public.bill_alerts a
   WHERE a.already_notified = FALSE
  ON CONFLICT (scheduled_transaction_id, kind, reference_date) DO NOTHING
  RETURNING id, user_id
)
SELECT * FROM gravados;

-- ZERO recem-gravados -> a rota manda ZERO e-mails. Nao ha contador separado
-- a manter: o que ja impedia o push dobrado impede o e-mail dobrado.
SELECT pg_temp.expect(
  '2a execucao do dia nao devolve nenhum aviso novo (= nenhum e-mail)',
  (SELECT count(*) FROM segunda_execucao), 0);

-- E o controle do outro lado: nao basta o upsert devolver zero, a tabela
-- tambem nao pode ter crescido.
SELECT pg_temp.expect(
  'a tabela continua com dois avisos depois das duas execucoes',
  (SELECT count(*) FROM public.bill_notifications), 2);

-- A view concorda: depois da 1a execucao ninguem mais tem alerta pendente.
SELECT pg_temp.expect(
  'bill_alerts nao tem mais nada pendente de aviso',
  (SELECT count(*) FROM public.bill_alerts WHERE already_notified = FALSE), 0);

-- =====================================================
-- SECAO 3: a view nao pode perder o security_invoker
-- =====================================================
-- Lido do catalogo, nao do arquivo da migration. Esta e a diferenca entre
-- provar que a opcao ESTA na view e provar que alguem a escreveu em algum
-- lugar -- e foi medido que CREATE OR REPLACE VIEW apaga os reloptions.

SELECT pg_temp.expect(
  'bill_alerts tem security_invoker=true no catalogo',
  (SELECT count(*) FROM pg_class
    WHERE relname = 'bill_alerts'
      AND relnamespace = 'public'::regnamespace
      AND reloptions @> ARRAY['security_invoker=true']),
  1);

-- =====================================================
-- SECAO 4: notify_email e preferencia de CANAL, nao de aviso
-- =====================================================

SELECT pg_temp.expect(
  'notify_email existe na view',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bill_alerts'
      AND column_name = 'notify_email'),
  1);

-- A Dora desligou o e-mail. A conta dela PRECISA continuar na view: e de la
-- que sai o sino do app, e o canal que ela desligou nao e esse.
SELECT pg_temp.expect(
  'a conta de quem desligou o e-mail CONTINUA na view',
  (SELECT count(*) FROM public.bill_alerts
    WHERE user_id = 'd3000000-0000-0000-0000-0000000000d1'),
  1);

SELECT pg_temp.expect_bool(
  'e a view diz que ela nao quer e-mail',
  (SELECT notify_email FROM public.bill_alerts
    WHERE user_id = 'd3000000-0000-0000-0000-0000000000d1'),
  FALSE);

-- O Eli nunca abriu a tela: sem linha em notification_preferences. O COALESCE
-- tem que responder `true` -- se responder NULL, a rota compara `=== false`,
-- nao recusa, e o resultado parece certo por acidente; se responder `false`,
-- o canal nasce desligado para a base inteira, em silencio.
SELECT pg_temp.expect_bool(
  'quem nunca abriu a tela de preferencias recebe e-mail (COALESCE)',
  (SELECT notify_email FROM public.bill_alerts
    WHERE user_id = 'd3000000-0000-0000-0000-0000000000e1'),
  TRUE);

-- =====================================================
-- SECAO 5: "enviado" tem que vir com o id da mensagem
-- =====================================================

-- As duas juntas: o caso bom.
UPDATE public.bill_notifications
   SET emailed_at = now(), email_message_id = 'msg_teste_183'
 WHERE user_id = 'd3000000-0000-0000-0000-0000000000e1';

SELECT pg_temp.expect(
  'marcar o envio com data E id e aceito',
  (SELECT count(*) FROM public.bill_notifications
    WHERE emailed_at IS NOT NULL AND email_message_id = 'msg_teste_183'),
  1);

-- Metade 1: data sem id. "Saiu" sem nada que permita conferir.
DO $$
BEGIN
  UPDATE public.bill_notifications
     SET emailed_at = now(), email_message_id = NULL
   WHERE user_id = 'd3000000-0000-0000-0000-0000000000d1';
  RAISE EXCEPTION 'FALHA: emailed_at sem email_message_id foi ACEITO';
EXCEPTION
  WHEN check_violation THEN
    RAISE NOTICE 'ok: emailed_at sem email_message_id recusado';
END $$;

-- Metade 2: id sem data.
DO $$
BEGIN
  UPDATE public.bill_notifications
     SET emailed_at = NULL, email_message_id = 'msg_sem_data'
   WHERE user_id = 'd3000000-0000-0000-0000-0000000000d1';
  RAISE EXCEPTION 'FALHA: email_message_id sem emailed_at foi ACEITO';
EXCEPTION
  WHEN check_violation THEN
    RAISE NOTICE 'ok: email_message_id sem emailed_at recusado';
END $$;

-- CONTROLE NEGATIVO do CHECK: as duas NULAS tem que continuar passando. Sem
-- esta assercao, um CHECK escrito como `emailed_at IS NOT NULL` tambem
-- deixaria as duas metades vermelhas -- e quebraria TODA linha de producao,
-- que nasce com as duas nulas.
SELECT pg_temp.expect(
  'as duas colunas nulas continuam validas (o estado de toda linha de hoje)',
  (SELECT count(*) FROM public.bill_notifications
    WHERE emailed_at IS NULL AND email_message_id IS NULL),
  1);

ROLLBACK;
