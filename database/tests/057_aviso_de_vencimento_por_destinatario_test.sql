-- =====================================================
-- Teste do aviso de vencimento por destinatario (057)
-- =====================================================
-- HMO-414. Roda no db-verify DEPOIS da 057 -- a posicao importa: rodando antes,
-- toda assercao sobre o fan-out veria a definicao da 050 e o arquivo ficaria
-- VERMELHO. Esse e o controle negativo deste teste, e ele e medido:
-- `PGDATABASE` parado na 056 reprova a SECAO 1 com "esperado 3, obtido 1".
--
-- O QUE ESTE ARQUIVO PRENDE
-- -------------------------
-- Cinco defeitos. QUATRO SAO SILENCIOSOS -- nenhum deles levanta erro, aparece
-- em log ou muda a tela:
--
--   1. O AVISO SAI SO PARA O DONO. Conta prevista de grupo e UMA linha, do
--      dono, e `bill_alerts` usava `s.user_id` como destinatario desde o 009.
--      A SECAO 1 exige o CONJUNTO de destinatarios, nao a contagem: `count(*)
--      = 3` passaria com o dono repetido tres vezes, que e o que um `JOIN`
--      errado produz.
--
--   2. `already_notified` NAO E POR PESSOA. O cron le com a RLS DESLIGADA,
--      entao ele ve o aviso de qualquer um: com o dono avisado, a conta sai da
--      varredura de amanha PARA TODOS. Um fan-out com a view consertada e este
--      EXISTS global avisa quem vier primeiro e nunca mais ninguem, com o job
--      verde. A SECAO 2 le a coluna com a credencial do cron, que e a unica em
--      que o defeito aparece.
--
--   3. A UNIQUE RECUSA O FAN-OUT, E O `ON CONFLICT DO NOTHING` ENGOLE. A rota
--      grava com `ignoreDuplicates: true`. Com a UNIQUE do 009 (sem `user_id`)
--      o segundo destinatario responde `INSERT 0 0`, sem erro: o fan-out
--      inteiro grava UMA linha. A SECAO 3 prova os dois lados -- os dois
--      destinatarios passam, E o mesmo destinatario duas vezes continua
--      barrado (a anti-spam do 009 nao pode ter sido trocada por nada).
--
--   4. A PREFERENCIA E DO DONO. `days_before` esta no WHERE da view: com o
--      join em `s.user_id`, o "me avise com 7 dias" de um membro nunca e
--      consultado, e uma conta a 5 dias nao entra na lista de NINGUEM. A
--      SECAO 4 mede a lista, nao o rotulo.
--
--   5. O DONO QUE SAIU DO GRUPO. Saida de grupo e soft delete; a conta
--      continua sendo dele e ele recebe aviso hoje. Sob "membros ativos" puro
--      ele sairia da lista -- uma regressao em quem JA recebe. A SECAO 5 e a
--      unica assercao que prende o `UNION` com o dono: sem ela, apagar esse
--      `UNION` numa refatoracao nao deixa nada vermelho.
--
-- O QUE ESTE ARQUIVO *NAO* MEDE, E POR QUE
-- ----------------------------------------
-- O controle negativo da RLS por `security_invoker` desta view. A 050 mediu
-- que apagar a flag de `bill_alerts` NAO vaza linha (quem protege e a flag de
-- `scheduled_transactions_effective`), e a 057 nao muda isso -- medido na
-- cadeia 001 -> 057, com e sem a flag: ZERO linhas nas duas. O `LATERAL` novo
-- toca `public.group_members` DIRETO, o que parecia reabrir o furo, e nao
-- reabre: o portao e o `FROM` de fora (sem linha visivel o LATERAL nao e
-- avaliado) e, para quem JA ve a conta, `group_members_select` (002) ja mostra
-- o grupo inteiro. Um controle negativo aqui passaria VAZIO.
--
-- Quem mede isso e, na ordem: a assercao de `reloptions` da SECAO 6 (catalogo,
-- que e o que de fato mudaria) e o step que RE-RODA o
-- `050_direcao_do_aviso_de_vencimento_test.sql` depois desta migration -- ele
-- tem uma assercao que REPROVA no dia em que esta view voltar a vazar como
-- DEFINER.
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

CREATE OR REPLACE FUNCTION pg_temp.expect_txt(label TEXT, got TEXT, want TEXT)
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
-- Grupo `Casa`, dono HELIO, membros ativos LAIS e ANA. Os tres sao membros
-- ativos sem nada a mais: a trigger do 001 inscreve o criador do grupo como
-- `admin`, e e por isso que o INSERT abaixo so acrescenta duas linhas.
--
-- Duas contas do grupo (uma a 2 dias, uma a 5) e uma PESSOAL do dono a 2 dias.
-- A pessoal e o controle de que o fan-out nao multiplica quem nao e de grupo.
--
-- NINGUEM tem linha em `notification_preferences` no comeco -- que e o estado
-- de todo mundo em producao, e o unico em que o COALESCE da view e exercitado.

INSERT INTO auth.users (id, email) VALUES
  ('41400000-0000-0000-0000-000000000001', 'helio-414@teste.local'),
  ('41400000-0000-0000-0000-000000000002', 'lais-414@teste.local'),
  ('41400000-0000-0000-0000-000000000003', 'ana-414@teste.local'),
  ('41400000-0000-0000-0000-00000000000f', 'estranho-414@teste.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('41400000-0000-0000-0000-000000000001', 'Helio 414',    FALSE),
  ('41400000-0000-0000-0000-000000000002', 'Lais 414',     FALSE),
  ('41400000-0000-0000-0000-000000000003', 'Ana 414',      FALSE),
  ('41400000-0000-0000-0000-00000000000f', 'Estranho 414', FALSE);

INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('41411111-1111-1111-1111-111111111111', 'Casa 414',
   '41400000-0000-0000-0000-000000000001');

INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('41411111-1111-1111-1111-111111111111', '41400000-0000-0000-0000-000000000002', 'member', 'active'),
  ('41411111-1111-1111-1111-111111111111', '41400000-0000-0000-0000-000000000003', 'member', 'active')
ON CONFLICT DO NOTHING;

-- O criador entrou pela trigger do 001. Se isso deixar de valer, as contagens
-- desta suite mudam por um motivo que nao e a 057 -- entao e assercao, nao
-- suposicao.
SELECT pg_temp.expect(
  'o grupo tem 3 membros ativos (o criador entra pela trigger do 001)',
  (SELECT count(*) FROM public.group_members
    WHERE group_id = '41411111-1111-1111-1111-111111111111' AND status = 'active'),
  3);

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('41422222-2222-2222-2222-222222222222', '41400000-0000-0000-0000-000000000001',
   'Conta Helio 414', 'checking', 5000);

-- `amount` POSITIVO: `scheduled_transactions` tem CHECK (amount > 0) -- a
-- direcao mora em `direction` (027), nao no sinal.
INSERT INTO public.scheduled_transactions
  (id, user_id, group_id, account_id, category_id, description, amount, due_date, status)
SELECT '41433333-3333-3333-3333-333333333333',
       '41400000-0000-0000-0000-000000000001',
       '41411111-1111-1111-1111-111111111111',
       '41422222-2222-2222-2222-222222222222',
       c.id, 'Luz da Casa 414', 300.00, CURRENT_DATE + 2, 'pending'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

INSERT INTO public.scheduled_transactions
  (id, user_id, group_id, account_id, category_id, description, amount, due_date, status)
SELECT '41444444-4444-4444-4444-444444444444',
       '41400000-0000-0000-0000-000000000001',
       NULL,
       '41422222-2222-2222-2222-222222222222',
       c.id, 'Netflix do Helio 414', 55.90, CURRENT_DATE + 2, 'pending'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

-- A 5 dias: FORA da janela de 3 dias do default e DENTRO da de 7 que a Lais
-- vai pedir na SECAO 4.
INSERT INTO public.scheduled_transactions
  (id, user_id, group_id, account_id, category_id, description, amount, due_date, status)
SELECT '41455555-5555-5555-5555-555555555555',
       '41400000-0000-0000-0000-000000000001',
       '41411111-1111-1111-1111-111111111111',
       '41422222-2222-2222-2222-222222222222',
       c.id, 'Condominio 414', 800.00, CURRENT_DATE + 5, 'pending'
  FROM public.transaction_categories c WHERE c.is_expense LIMIT 1;

-- =====================================================
-- SECAO 1: o CONJUNTO de destinatarios
-- =====================================================
-- Lido com a RLS desligada, que e a credencial do cron -- a unica que ve o
-- conjunto inteiro, e a unica que importa para quem ENVIA.
--
-- A assercao e sobre o conjunto ORDENADO de nomes, e nao sobre `count(*)`:
-- tres linhas do MESMO dono (um `JOIN` que multiplica sem trocar o
-- destinatario) satisfazem a contagem e nao mandam e-mail para ninguem novo.

SELECT pg_temp.expect_txt(
  'a conta do GRUPO rende uma linha por membro ativo, mais o dono',
  (SELECT string_agg(p.full_name, ', ' ORDER BY p.full_name)
     FROM public.bill_alerts b
     JOIN public.profiles p ON p.id = b.user_id
    WHERE b.scheduled_transaction_id = '41433333-3333-3333-3333-333333333333'),
  'Ana 414, Helio 414, Lais 414');

-- O CONTROLE: conta que nao e de grupo continua em UMA linha. Sem isto, um
-- `CROSS JOIN` sem o recorte `s.group_id IS NOT NULL` passaria a SECAO 1 e
-- mandaria a conta pessoal de cada um para todo mundo que divide qualquer
-- grupo com a pessoa.
SELECT pg_temp.expect(
  'a conta PESSOAL continua rendendo UMA linha',
  (SELECT count(*) FROM public.bill_alerts
    WHERE scheduled_transaction_id = '41444444-4444-4444-4444-444444444444'),
  1);

SELECT pg_temp.expect_txt(
  'e o destinatario dela e o dono',
  (SELECT p.full_name FROM public.bill_alerts b
     JOIN public.profiles p ON p.id = b.user_id
    WHERE b.scheduled_transaction_id = '41444444-4444-4444-4444-444444444444'),
  'Helio 414');

-- O estranho nao entra em lista nenhuma. Esta assercao e sobre o CONJUNTO (a
-- RLS esta desligada aqui), nao sobre RLS: ela prende o `gm.group_id =
-- s.group_id` do LATERAL. Sem ele, os destinatarios seriam os membros ativos
-- de TODOS os grupos do banco.
SELECT pg_temp.expect(
  'quem nao e do grupo nao recebe aviso da conta do grupo',
  (SELECT count(*) FROM public.bill_alerts
    WHERE scheduled_transaction_id = '41433333-3333-3333-3333-333333333333'
      AND user_id = '41400000-0000-0000-0000-00000000000f'),
  0);

-- =====================================================
-- SECAO 2: already_notified e POR PESSOA
-- =====================================================
-- A credencial aqui e a do CRON (RLS desligada), de proposito: lido como o
-- membro, o `EXISTS` global JA respondia `false` (a policy
-- `bill_notifications_select` esconde o aviso alheio), entao o defeito nao
-- aparece. Ele aparece so para quem decide o envio.

INSERT INTO public.bill_notifications
  (user_id, scheduled_transaction_id, kind, reference_date, title, body, channel)
VALUES
  ('41400000-0000-0000-0000-000000000001', '41433333-3333-3333-3333-333333333333',
   'due_soon', CURRENT_DATE + 2, 'Luz da Casa', 'vence em 2 dias', 'inapp');

SELECT pg_temp.expect_bool(
  'o DONO avisado conta como avisado',
  (SELECT already_notified FROM public.bill_alerts
    WHERE scheduled_transaction_id = '41433333-3333-3333-3333-333333333333'
      AND user_id = '41400000-0000-0000-0000-000000000001'),
  TRUE);

SELECT pg_temp.expect(
  'e o aviso DELE nao marca mais ninguem como avisado',
  (SELECT count(*) FROM public.bill_alerts
    WHERE scheduled_transaction_id = '41433333-3333-3333-3333-333333333333'
      AND already_notified),
  1);

-- A forma em que o cron le: e dela que sai a lista de envio.
SELECT pg_temp.expect(
  'a varredura de amanha ainda tem 2 destinatarios a avisar',
  (SELECT count(*) FROM public.bill_alerts
    WHERE scheduled_transaction_id = '41433333-3333-3333-3333-333333333333'
      AND already_notified = FALSE),
  2);

-- =====================================================
-- SECAO 3: a UNIQUE aceita o fan-out e continua barrando o repeteco
-- =====================================================
-- Os dois lados no mesmo lugar, porque trocar um pelo outro e o acidente
-- obvio: alargar a UNIQUE "resolve" o fan-out e pode ter apagado a anti-spam
-- que o 009 escreveu, e um `count(*) >= 2` passaria nos dois mundos.

-- O segundo DESTINATARIO: tem de gravar. `ON CONFLICT DO NOTHING` e
-- exatamente o que a rota faz (`ignoreDuplicates: true`), e e o que torna o
-- defeito silencioso -- com a UNIQUE estreita isto responde `INSERT 0 0`.
WITH ins AS (
  INSERT INTO public.bill_notifications
    (user_id, scheduled_transaction_id, kind, reference_date, title, body, channel)
  VALUES
    ('41400000-0000-0000-0000-000000000002', '41433333-3333-3333-3333-333333333333',
     'due_soon', CURRENT_DATE + 2, 'Luz da Casa', 'vence em 2 dias', 'inapp')
  ON CONFLICT (scheduled_transaction_id, user_id, kind, reference_date) DO NOTHING
  RETURNING 1
)
SELECT pg_temp.expect(
  'o aviso do SEGUNDO destinatario grava (nao e engolido pelo ON CONFLICT)',
  (SELECT count(*) FROM ins),
  1);

-- O MESMO destinatario, de novo: nao pode gravar. E a linha do 009 que impede
-- o app de virar spam, e ela continua valendo -- agora por pessoa.
WITH ins AS (
  INSERT INTO public.bill_notifications
    (user_id, scheduled_transaction_id, kind, reference_date, title, body, channel)
  VALUES
    ('41400000-0000-0000-0000-000000000002', '41433333-3333-3333-3333-333333333333',
     'due_soon', CURRENT_DATE + 2, 'Luz da Casa', 'de novo', 'inapp')
  ON CONFLICT (scheduled_transaction_id, user_id, kind, reference_date) DO NOTHING
  RETURNING 1
)
SELECT pg_temp.expect(
  'o MESMO destinatario duas vezes continua barrado (a anti-spam do 009)',
  (SELECT count(*) FROM ins),
  0);

SELECT pg_temp.expect(
  'duas linhas de aviso para a conta do grupo, uma por pessoa',
  (SELECT count(*) FROM public.bill_notifications
    WHERE scheduled_transaction_id = '41433333-3333-3333-3333-333333333333'),
  2);

-- O CONTROLE NEGATIVO DESTA SECAO, e ele e obrigatorio: o defeito da UNIQUE e
-- SILENCIOSO (`INSERT 0 0`, sem erro), entao uma suite que so afirma "gravou 2"
-- nao prova que a chave e o que permitiu. Com a UNIQUE do 009 de volta, o
-- mesmo INSERT do segundo destinatario tem de ser engolido.
--
-- Roda dentro da transacao do teste e e desfeito logo abaixo; o ROLLBACK do fim
-- do arquivo e a segunda rede.
DELETE FROM public.bill_notifications
 WHERE scheduled_transaction_id = '41433333-3333-3333-3333-333333333333'
   AND user_id = '41400000-0000-0000-0000-000000000002';

ALTER TABLE public.bill_notifications DROP CONSTRAINT bill_notifications_unique;
ALTER TABLE public.bill_notifications
  ADD CONSTRAINT bill_notifications_unique
  UNIQUE (scheduled_transaction_id, kind, reference_date);

WITH ins AS (
  INSERT INTO public.bill_notifications
    (user_id, scheduled_transaction_id, kind, reference_date, title, body, channel)
  VALUES
    ('41400000-0000-0000-0000-000000000002', '41433333-3333-3333-3333-333333333333',
     'due_soon', CURRENT_DATE + 2, 'Luz da Casa', 'vence em 2 dias', 'inapp')
  ON CONFLICT (scheduled_transaction_id, kind, reference_date) DO NOTHING
  RETURNING 1
)
SELECT pg_temp.expect(
  'CONTROLE NEGATIVO: com a UNIQUE do 009 o segundo destinatario e ENGOLIDO',
  (SELECT count(*) FROM ins),
  0);

ALTER TABLE public.bill_notifications DROP CONSTRAINT bill_notifications_unique;
ALTER TABLE public.bill_notifications
  ADD CONSTRAINT bill_notifications_unique
  UNIQUE (scheduled_transaction_id, user_id, kind, reference_date);

-- E a forma da chave, lida do CATALOGO. O `onConflict` da rota do cron manda
-- esta lista de colunas e o PostgREST exige um indice unico que case com ela:
-- divergir aqui faz o cron responder ERRO todo dia, nao "ignorei o conflito".
SELECT pg_temp.expect_txt(
  'bill_notifications_unique e (conta, PESSOA, tipo, data)',
  (SELECT string_agg(a.attname, ',' ORDER BY a.attname)
     FROM pg_constraint c
     CROSS JOIN LATERAL unnest(c.conkey) AS k(attnum)
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.conrelid = 'public.bill_notifications'::regclass
      AND c.conname  = 'bill_notifications_unique'
      AND c.contype  = 'u'),
  'kind,reference_date,scheduled_transaction_id,user_id');

-- =====================================================
-- SECAO 4: a preferencia e DE QUEM RECEBE, e ela muda a LISTA
-- =====================================================
-- `days_before` esta no WHERE da view. Esta secao e a que distingue "trocamos
-- o rotulo" de "trocamos a lista": a Lais pede 7 dias e passa a ver uma conta
-- que o dono (nos 3 do default) nao ve.

INSERT INTO public.notification_preferences (user_id, days_before)
VALUES ('41400000-0000-0000-0000-000000000002', 7);

SELECT pg_temp.expect_txt(
  'a conta a 5 dias entra SO na lista de quem pediu 7 dias',
  (SELECT string_agg(p.full_name, ', ' ORDER BY p.full_name)
     FROM public.bill_alerts b
     JOIN public.profiles p ON p.id = b.user_id
    WHERE b.scheduled_transaction_id = '41455555-5555-5555-5555-555555555555'),
  'Lais 414');

SELECT pg_temp.expect(
  'e o days_before que a view devolve e o DELA, nao o do dono',
  (SELECT days_before FROM public.bill_alerts
    WHERE scheduled_transaction_id = '41455555-5555-5555-5555-555555555555'),
  7);

-- `notify_email` pelo mesmo join: preferencia de CANAL do destinatario. O
-- dono desliga o e-mail e isso NAO pode desligar o da Lais -- era o que
-- acontecia, porque a linha era uma so e era a dele.
INSERT INTO public.notification_preferences (user_id, days_before, notify_email)
VALUES ('41400000-0000-0000-0000-000000000001', 3, FALSE);

SELECT pg_temp.expect_bool(
  'o dono desligou o e-mail: a linha DELE sai com notify_email = false',
  (SELECT notify_email FROM public.bill_alerts
    WHERE scheduled_transaction_id = '41433333-3333-3333-3333-333333333333'
      AND user_id = '41400000-0000-0000-0000-000000000001'),
  FALSE);

SELECT pg_temp.expect_bool(
  'e a linha da LAIS continua com o e-mail ligado',
  (SELECT notify_email FROM public.bill_alerts
    WHERE scheduled_transaction_id = '41433333-3333-3333-3333-333333333333'
      AND user_id = '41400000-0000-0000-0000-000000000002'),
  TRUE);

-- E a conta continua no SINO de quem desligou o e-mail: `notify_email` e
-- preferencia de canal e nao entra no WHERE (SECAO 4 do teste da 047, repetida
-- aqui porque a 057 reescreve a view inteira e poderia perder isso).
SELECT pg_temp.expect(
  'desligar o e-mail nao apaga a conta do sino do dono',
  (SELECT count(*) FROM public.bill_alerts
    WHERE scheduled_transaction_id = '41433333-3333-3333-3333-333333333333'
      AND user_id = '41400000-0000-0000-0000-000000000001'),
  1);

DELETE FROM public.notification_preferences
 WHERE user_id IN ('41400000-0000-0000-0000-000000000001',
                   '41400000-0000-0000-0000-000000000002');

-- =====================================================
-- SECAO 5: o dono que SAIU do grupo continua recebendo
-- =====================================================
-- ESTA E A SECAO QUE PRENDE O `UNION` COM O DONO. Sem ela, trocar o LATERAL
-- por um `JOIN group_members` simples passa em todo o resto do arquivo -- e
-- tira o aviso de quem recebe hoje, que e a unica regressao que esta issue nao
-- podia causar.
--
-- Saida de grupo e SOFT DELETE (051): a linha fica com `status = 'inactive'`,
-- e a conta prevista continua com `group_id` e continua sendo do dono.

UPDATE public.group_members
   SET status = 'inactive'
 WHERE group_id = '41411111-1111-1111-1111-111111111111'
   AND user_id = '41400000-0000-0000-0000-000000000001';

SELECT pg_temp.expect_txt(
  'o dono que saiu do grupo CONTINUA na lista (o UNION com s.user_id)',
  (SELECT string_agg(p.full_name, ', ' ORDER BY p.full_name)
     FROM public.bill_alerts b
     JOIN public.profiles p ON p.id = b.user_id
    WHERE b.scheduled_transaction_id = '41433333-3333-3333-3333-333333333333'),
  'Ana 414, Helio 414, Lais 414');

-- E o outro lado do soft delete: quem sai PARA de receber. Sem esta assercao,
-- um LATERAL sem o recorte `status = 'active'` passaria na de cima.
UPDATE public.group_members
   SET status = 'inactive'
 WHERE group_id = '41411111-1111-1111-1111-111111111111'
   AND user_id = '41400000-0000-0000-0000-000000000003';

SELECT pg_temp.expect_txt(
  'o MEMBRO que saiu do grupo para de receber',
  (SELECT string_agg(p.full_name, ', ' ORDER BY p.full_name)
     FROM public.bill_alerts b
     JOIN public.profiles p ON p.id = b.user_id
    WHERE b.scheduled_transaction_id = '41433333-3333-3333-3333-333333333333'),
  'Helio 414, Lais 414');

UPDATE public.group_members
   SET status = 'active'
 WHERE group_id = '41411111-1111-1111-1111-111111111111'
   AND user_id IN ('41400000-0000-0000-0000-000000000001',
                   '41400000-0000-0000-0000-000000000003');

-- =====================================================
-- SECAO 6: o catalogo -- security_invoker e o recorte que a 050 deixou
-- =====================================================
-- `CREATE OR REPLACE VIEW` APAGA os reloptions, e a 057 recria `bill_alerts`.
-- A assercao e sobre o CATALOGO porque o vazamento de linha nao depende mais
-- desta flag (ver o cabecalho): aqui ela e o que de fato mudaria se o ALTER
-- VIEW do fim da migration sumisse.

SELECT pg_temp.expect(
  'bill_alerts continua com security_invoker depois da 057',
  (SELECT count(*) FROM pg_class
    WHERE oid = 'public.bill_alerts'::regclass
      AND COALESCE(reloptions @> ARRAY['security_invoker=true'], FALSE)),
  1);

-- O recorte do 009 sobre o estado GRAVADO, nao sobre `effective_status` nem
-- `my_status`. Repetido aqui porque a 057 reescreve o WHERE inteiro: filtrar
-- por `effective_status` apagaria do aviso toda conta VENCIDA, que e metade do
-- que a view existe para avisar.
UPDATE public.scheduled_transactions
   SET due_date = CURRENT_DATE - 3
 WHERE id = '41433333-3333-3333-3333-333333333333';

SELECT pg_temp.expect_txt(
  'a conta VENCIDA do grupo avisa os 3, com kind = overdue',
  (SELECT string_agg(DISTINCT b.kind, ',') || ' x' || count(*)::text
     FROM public.bill_alerts b
    WHERE b.scheduled_transaction_id = '41433333-3333-3333-3333-333333333333'),
  'overdue x3');

UPDATE public.scheduled_transactions
   SET due_date = CURRENT_DATE + 2
 WHERE id = '41433333-3333-3333-3333-333333333333';

-- E a conta PAGA sai da view para todos -- o recorte `status = 'pending'`.
--
-- A baixa vai pelo caminho de verdade: `scheduled_transactions_paid_check`
-- (005) exige `paid_date` E `transaction_id` juntos, entao nao da para forjar a
-- baixa com um UPDATE de uma coluna so.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, account_id, category_id, description, amount, transaction_date, transaction_type)
SELECT '41466666-6666-6666-6666-666666666666', '41400000-0000-0000-0000-000000000001',
       s.id, '41422222-2222-2222-2222-222222222222', c.id, 'Luz da Casa 414', -300.00,
       CURRENT_DATE, 'expense'
  FROM public.transaction_categories c, public.financial_services s
 WHERE c.is_expense LIMIT 1;

UPDATE public.scheduled_transactions
   SET status = 'paid', paid_date = CURRENT_DATE,
       transaction_id = '41466666-6666-6666-6666-666666666666'
 WHERE id = '41433333-3333-3333-3333-333333333333';

SELECT pg_temp.expect(
  'conta paga sai do aviso de TODOS os destinatarios',
  (SELECT count(*) FROM public.bill_alerts
    WHERE scheduled_transaction_id = '41433333-3333-3333-3333-333333333333'),
  0);

UPDATE public.scheduled_transactions
   SET status = 'pending', paid_date = NULL, transaction_id = NULL
 WHERE id = '41433333-3333-3333-3333-333333333333';

-- =====================================================
-- SECAO 7: o que o MEMBRO ve, e por que o sino precisa filtrar
-- =====================================================
-- A leitura do app, com a RLS LIGADA. Duas coisas aqui, e a segunda e um
-- requisito para o codigo, nao para o banco:
--
--   * a linha da Lais EXISTE e e dela. Antes da 057 ela via a linha com o
--     `user_id` do HELIO -- a conta aparecia no sino e o aviso nunca era dela;
--   * ela ve TRES linhas da mesma conta, porque `group_members_select` (002)
--     mostra o grupo inteiro a qualquer membro. **A RLS NAO recorta o fan-out
--     para o leitor**, e e por isso que `GET /api/notifications` passou a
--     filtrar `user_id = o usuario logado`. Esta assercao e o que reprova se
--     alguem apagar esse filtro achando que a RLS cobre.

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '41400000-0000-0000-0000-000000000002';

SELECT pg_temp.expect(
  'a Lais tem a PROPRIA linha de aviso da conta do grupo',
  (SELECT count(*) FROM public.bill_alerts
    WHERE scheduled_transaction_id = '41433333-3333-3333-3333-333333333333'
      AND user_id = '41400000-0000-0000-0000-000000000002'),
  1);

SELECT pg_temp.expect(
  'e ela ve as 3 linhas: a RLS NAO recorta o fan-out -- quem filtra e o sino',
  (SELECT count(*) FROM public.bill_alerts
    WHERE scheduled_transaction_id = '41433333-3333-3333-3333-333333333333'),
  3);

-- A conta PESSOAL do dono continua invisivel para ela: o fan-out nao abriu
-- porta nenhuma. (A RLS de `scheduled_transactions` e o portao, e o LATERAL
-- nunca e avaliado para uma linha que o leitor nao ve.)
SELECT pg_temp.expect(
  'a conta PESSOAL do dono continua invisivel para a Lais',
  (SELECT count(*) FROM public.bill_alerts
    WHERE scheduled_transaction_id = '41444444-4444-4444-4444-444444444444'),
  0);

RESET ROLE;
RESET request.jwt.claim.sub;

-- E o estranho, que nao e membro: nada.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '41400000-0000-0000-0000-00000000000f';

SELECT pg_temp.expect(
  'quem nao e do grupo nao ve a conta do grupo (RLS ligada)',
  (SELECT count(*) FROM public.bill_alerts
    WHERE scheduled_transaction_id = '41433333-3333-3333-3333-333333333333'),
  0);

RESET ROLE;
RESET request.jwt.claim.sub;

ROLLBACK;
