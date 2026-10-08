-- 047_aviso_por_email.sql
--
-- HMO-183: o canal de e-mail do aviso de vencimento (Fase 5, HMO-140).
--
-- A deteccao de vencimento ja funciona em producao desde o 009: `bill_alerts`
-- diz o que vence e `bill_notifications` guarda o que ja foi avisado. O push
-- ja esta escrito. O que falta e o e-mail, e esta migration abre as tres
-- lacunas de schema que ele precisa:
--
--   1. `notification_preferences.notify_email`  -- quem quer receber;
--   2. `bill_alerts.notify_email`               -- a mesma resposta, exposta
--      na UNICA definicao que o cron e o sino do app leem;
--   3. `bill_notifications.emailed_at` / `.email_message_id` -- a PROVA de que
--      saiu, com o id da mensagem no provedor.
--
-- ===========================================================================
-- POR QUE O DEFAULT DE notify_email E `true`
-- ===========================================================================
-- Nao e a escolha obvia: coluna nova ligada por padrao inscreve todo mundo num
-- canal que ninguem pediu, no instante em que a chave do provedor for colada.
-- Foi escolhida assim mesmo assim, por tres razoes, e a terceira e a que pesa:
--
--   a) a view ja trata ausencia de linha como "sim" em TODAS as preferencias
--      (`COALESCE(p.notify_due_soon, true)`, `COALESCE(p.days_before, 3)`).
--      Hoje ninguem tem linha em `notification_preferences` -- um default
--      `false` aqui seria a unica preferencia que significa "nao" quando
--      ausente, e a view passaria a ter duas convencoes opostas lado a lado;
--
--   b) o aviso e transacional e foi o motivo de a pessoa instalar o app: e uma
--      conta DELA vencendo, nao uma campanha;
--
--   c) um canal que nasce desligado e um canal que ninguem liga. Esse e o
--      defeito que esta issue existe para consertar: o push ficou meses
--      desligado em producao sem aparecer em lugar nenhum. Repetir o desenho
--      no e-mail seria entregar o mesmo silencio com um nome novo.
--
-- O contrapeso esta no app, nao no schema: a tela de Avisos tem o botao de
-- desligar, e o rodape do e-mail diz onde ele fica.
--
-- ===========================================================================
-- POR QUE `channel` NAO GANHA O VALOR 'email'
-- ===========================================================================
-- `bill_notifications.channel` e uma coluna de valor UNICO com CHECK IN
-- ('inapp','push'), e o cron a promove de 'inapp' para 'push' quando o push
-- sai. Com tres canais ela deixa de conseguir representar o caso normal --
-- sino E push E e-mail, os tres no mesmo aviso. Acrescentar 'email' ao CHECK
-- tornaria a coluna MAIS ambigua: 'push' passaria a significar "push, e sobre
-- o e-mail nao se sabe".
--
-- Entao o e-mail ganha colunas proprias. `emailed_at` responde "saiu?" e
-- `email_message_id` responde "qual mensagem?" -- e e o segundo que importa,
-- porque e com ele que se confere a entrega no painel do provedor. Resposta
-- 200 da rota nao prova entrega nenhuma.
--
-- `channel` fica como esta, intocada, e o COMMENT abaixo registra que ela nao
-- fala sobre e-mail -- para que o proximo leitor nao conclua de um
-- `channel='push'` que o e-mail nao saiu.
--
-- ===========================================================================
-- IDEMPOTENTE, E SEM META-COMANDO
-- ===========================================================================
-- Producao nao tem runner de migration: uma pessoa cola este arquivo no SQL
-- Editor do Supabase (ver a nota no topo do 015). Rodar duas vezes tem que ser
-- inofensivo, e nenhuma linha pode ser meta-comando do psql (`\...`) -- uma
-- unica delas reprova o arquivo INTEIRO.
--
-- Todo ADD COLUMN aqui e `IF NOT EXISTS` e NULAVEL ou com DEFAULT, entao
-- nenhuma escrita que o app ja faz passa a falhar no meio da colagem.

-- =====================================================
-- SECAO 1: A PREFERENCIA
-- =====================================================

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.notification_preferences.notify_email IS
  'Receber o aviso de vencimento por e-mail. Linha ausente = true, pelo mesmo '
  'COALESCE que ja vale para days_before e notify_due_soon em bill_alerts.';

-- =====================================================
-- SECAO 2: A PROVA DE ENVIO
-- =====================================================

ALTER TABLE public.bill_notifications
  ADD COLUMN IF NOT EXISTS emailed_at timestamp with time zone;

ALTER TABLE public.bill_notifications
  ADD COLUMN IF NOT EXISTS email_message_id text;

COMMENT ON COLUMN public.bill_notifications.emailed_at IS
  'Quando o e-mail foi aceito pelo provedor. NULL = nao saiu (canal desligado, '
  'usuario sem endereco, ou falha).';

COMMENT ON COLUMN public.bill_notifications.email_message_id IS
  'O id da mensagem no provedor. E ele que permite conferir a entrega no painel '
  '-- 200 na resposta da rota nao prova entrega.';

COMMENT ON COLUMN public.bill_notifications.channel IS
  'Sino do app ou push. NAO fala sobre e-mail: um aviso com channel=''push'' '
  'pode ter saido tambem por e-mail -- quem responde isso e emailed_at.';

-- O e-mail so pode ser marcado com o id da mensagem junto, e vice-versa. Uma
-- `emailed_at` sem id e um envio que nao da para conferir; um id sem data e um
-- registro sem quando. Nos dois casos a linha diz "saiu" sem sustentar.
ALTER TABLE public.bill_notifications
  DROP CONSTRAINT IF EXISTS bill_notifications_email_completo_check;
ALTER TABLE public.bill_notifications
  ADD CONSTRAINT bill_notifications_email_completo_check
  CHECK ((emailed_at IS NULL) = (email_message_id IS NULL));

-- As linhas que ja existem em producao tem as duas colunas NULAS, entao o
-- CHECK acima e satisfeito por todas elas e o ALTER nao precisa de NOT VALID.

-- =====================================================
-- SECAO 3: A VIEW
-- =====================================================
-- `bill_alerts` e a unica definicao de "o que merece aviso hoje", lida pelo
-- cron e pelo sino do app. A preferencia de e-mail entra AQUI, e nao numa
-- consulta separada dentro da rota, pelo motivo que o 009 ja escreveu: duas
-- consultas saem de sincronia na primeira vez que alguem mexe numa delas.
--
-- O corpo abaixo e o do 009 com UMA linha nova (`notify_email`). Esta repetido
-- inteiro porque o Postgres nao tem "adicionar coluna a view": CREATE OR
-- REPLACE VIEW exige as colunas antigas, na mesma ordem e com os mesmos tipos,
-- e so aceita colunas NOVAS no fim.

CREATE OR REPLACE VIEW public.bill_alerts AS
  SELECT
    s.id AS scheduled_transaction_id,
    s.user_id,
    s.group_id,
    s.account_id,
    s.description,
    s.amount,
    s.due_date,
    (s.due_date - CURRENT_DATE) AS days_until,
    CASE WHEN s.due_date < CURRENT_DATE THEN 'overdue' ELSE 'due_soon' END AS kind,
    COALESCE(p.days_before, 3) AS days_before,
    COALESCE(r.transaction_type, 'expense') AS transaction_type,
    EXISTS (
      SELECT 1 FROM public.bill_notifications n
      WHERE n.scheduled_transaction_id = s.id
        AND n.kind = (CASE WHEN s.due_date < CURRENT_DATE THEN 'overdue' ELSE 'due_soon' END)
        AND n.reference_date = s.due_date
    ) AS already_notified,
    -- A coluna nova. Mesmo COALESCE das outras preferencias: quem nunca abriu
    -- a tela nao tem linha, e ausencia significa "sim" -- ver o cabecalho.
    COALESCE(p.notify_email, true) AS notify_email
  FROM public.scheduled_transactions s
  LEFT JOIN public.notification_preferences p ON p.user_id = s.user_id
  LEFT JOIN public.recurring_rules r ON r.id = s.recurring_rule_id
  WHERE s.status = 'pending'
    AND (
      (s.due_date < CURRENT_DATE AND COALESCE(p.notify_overdue, true))
      OR (s.due_date >= CURRENT_DATE
          AND COALESCE(p.notify_due_soon, true)
          AND s.due_date - CURRENT_DATE <= COALESCE(p.days_before, 3))
    );

-- `notify_email` NAO entra no WHERE de proposito. A view responde "o que
-- merece aviso hoje", e o sino do app mostra a mesma lista: filtrar por e-mail
-- aqui apagaria do SINO a conta de quem desligou so o e-mail. A preferencia e
-- de CANAL, e quem a consome e a rota do cron, na hora de escolher para quem
-- mandar -- depois de gravar o aviso para todo mundo.

-- ===========================================================================
-- CREATE OR REPLACE VIEW APAGA OS reloptions -- MEDIDO, NAO SUPOSTO
-- ===========================================================================
-- `security_invoker` e um reloption, e ele NAO sobrevive ao CREATE OR REPLACE
-- acima. Sem a linha abaixo a view volta a rodar com os privilegios do DONO, a
-- RLS de `scheduled_transactions` deixa de ser aplicada, e o sino do app de
-- cada usuario passa a listar as contas a vencer de TODO MUNDO -- sem erro,
-- sem aviso, e com os numeros parecendo plausiveis.
--
-- Esta linha e identica a do 009 e e obrigatoria em toda migration que recria
-- esta view.
ALTER VIEW public.bill_alerts SET (security_invoker = true);

COMMENT ON VIEW public.bill_alerts IS
  'Contas que merecem aviso hoje, com already_notified e a preferencia de canal '
  'notify_email. Uma definicao para o cron e para o sino do app.';

-- `bill_alerts` e recriada pelo CREATE OR REPLACE, o que PRESERVA os GRANTs
-- existentes (ao contrario dos reloptions). O 009 ja deu SELECT a
-- `authenticated`; nada a refazer aqui.
