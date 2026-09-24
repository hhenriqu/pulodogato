-- =====================================================
-- PULODOGATO - O RESUMO DO MES FECHADO ENTRA NO SINO
-- =====================================================
-- Migration: 017_monthly_summary_notifications
-- Gerado em: 2026-09-24  (HMO-154)
--
-- O QUE FALTAVA
-- -------------
-- O resumo do mes fechado ja e CALCULADO (lib/anomalies.ts, com 27 testes e
-- sete mutacoes provadas). O que nao existia era o canal: o cron precisa
-- gravar em bill_notifications, e a tabela -- do jeito que a 016 a deixou --
-- RECUSA a linha do resumo. Nao e falta de coluna: e o CHECK
-- `bill_notifications_one_reference_check`, que exige exatamente UMA referencia
-- preenchida entre `scheduled_transaction_id` e `recurrence_id`.
--
-- E um resumo de mes nao aponta para nenhum dos dois. Ele nao e sobre uma conta
-- nem sobre uma assinatura; e sobre um MES. Sem esta migration o cron responde
-- 500 com "violates check constraint" em toda execucao -- e a mensagem cita o
-- nome da constraint, nao o desenho, entao quem for depurar vai olhar para a
-- rota antes de olhar para a tabela.
--
-- A 016 acertou em generalizar bill_notifications em vez de criar uma segunda
-- tabela (o sino do app e UMA lista, e duas tabelas produzem um sino que mostra
-- 2 avisos e um contador que diz 5). Esta migration segue a mesma linha e
-- admite a TERCEIRA familia -- com a diferenca de que esta nao tem objeto para
-- apontar.
--
-- =====================================================
-- POR QUE UMA COLUNA NOVA, E NAO A `reference_date` QUE JA EXISTE
-- =====================================================
-- A deduplicacao e a razao de ser deste arquivo: o cron do resumo roda todo dia
-- 1, e a Vercel no plano Hobby tem +-59min de precisao -- uma execucao dupla na
-- virada nao e hipotese remota. Sem chave unica, quem acorda dia 1 recebe o
-- resumo de setembro duas vezes.
--
-- A chave obvia seria (user_id, kind, reference_date). Ela NAO serve, e o
-- motivo nao aparece ate a familia antiga quebrar em producao: duas contas
-- diferentes que vencem NO MESMO DIA geram dois avisos `due_soon` do mesmo
-- usuario com a mesma `reference_date`. Um indice unico sobre essas tres
-- colunas recusaria o segundo -- e o usuario deixaria de ser avisado de uma
-- conta que vence hoje, sem nada no log dizendo por que. Seria trocar um aviso
-- repetido por um aviso PERDIDO, que e o erro caro dos dois.
--
-- Entao a familia do resumo ganha a propria coluna, `summary_month`, e o indice
-- e sobre ela. Nas linhas das outras duas familias `summary_month` e NULL, e em
-- indice unico NULL nunca colide com NULL -- as linhas de conta e de assinatura
-- atravessam o indice sem se ver. E o mesmo mecanismo que a 016 usou para o
-- indice de recorrencia conviver com as linhas de conta prevista.
--
-- O INDICE E CHEIO, NAO PARCIAL -- e tem que continuar assim. Um indice unico
-- PARCIAL nao pode ser inferido como arbitro de ON CONFLICT pela lista de
-- colunas que o PostgREST manda (o `onConflict:` do supabase-js nao tem como
-- transportar o `WHERE` do indice), e o upsert do cron passaria a responder
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" em TODA execucao. Ver a secao "A ARMADILHA" no cabecalho da
-- 016: e a mesma, e ela ja custou uma migration refeita.
--
-- `summary_month` guarda o primeiro dia do mes FECHADO ('2026-09-01' para o
-- resumo de setembro), igual ao grao de `date_trunc('month', ...)` das views do
-- 008. `reference_date` continua sendo preenchida com o mesmo valor, porque e
-- NOT NULL desde a 009 e e ela que a tela usa para ordenar -- a redundancia e
-- consciente e o preco de manter a familia antiga intacta.
--
-- SEM META-COMANDO DE psql AQUI -- ESTE ARQUIVO E COLADO NO SQL EDITOR
-- ---------------------------------------------------------------------
-- Producao nao tem runner de migration: quem aplica e uma pessoa, colando o
-- arquivo no SQL Editor do Supabase, que fala Postgres e NAO e o psql. Uma
-- unica linha comecando com barra invertida vira `syntax error at or near "\"`
-- e, por estar ANTES do primeiro comando executavel, faz o arquivo INTEIRO ser
-- recusado -- nada e aplicado e o banco nao muda. Aconteceu com a 015 e a 016.
-- Ha guard no CI para isso desde entao (scripts/check-migrations-in-ci.mjs).
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: pre-requisitos
-- =====================================================
-- Sem isto a migration falha mais adiante com "constraint does not exist", que
-- nao diz QUAL migration ficou para tras.
DO $$
BEGIN
  IF to_regclass('public.bill_notifications') IS NULL THEN
    RAISE EXCEPTION '017 exige public.bill_notifications (migration 009) -- aplique o 009 primeiro.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.bill_notifications'::regclass
      AND attname = 'recurrence_id' AND attnum > 0 AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '017 exige bill_notifications.recurrence_id (migration 016) -- aplique o 016 primeiro.';
  END IF;
END $$;

-- =====================================================
-- SECAO 1: a coluna que identifica o mes resumido
-- =====================================================
ALTER TABLE public.bill_notifications
  ADD COLUMN IF NOT EXISTS summary_month date;

COMMENT ON COLUMN public.bill_notifications.summary_month IS
  'Primeiro dia do mes FECHADO que este resumo cobre. Preenchida so na familia monthly_summary; NULL nas outras duas -- e esse NULL que deixa o indice unico cheio conviver com elas.';

-- O resumo e sobre um mes inteiro: um valor que nao seja o dia 1 significa que
-- alguem gravou uma data de transacao no lugar do mes, e ai duas execucoes do
-- mesmo mes deixam de colidir no indice -- o aviso repetiria, que e exatamente
-- o que este arquivo existe para impedir. Barato de verificar, caro de nao ver.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_summary_month_check'
  ) THEN
    ALTER TABLE public.bill_notifications
      ADD CONSTRAINT bill_notifications_summary_month_check
      CHECK (summary_month IS NULL OR summary_month = date_trunc('month', summary_month)::date);
  END IF;
END $$;

-- =====================================================
-- SECAO 2: o dominio de `kind` admite a terceira familia
-- =====================================================
-- Continua FECHADO de proposito: `kind` e o que a tela e o push usam para
-- escolher icone e destino do clique, e um `kind` digitado errado precisa virar
-- erro, nao uma linha invisivel no sino.
ALTER TABLE public.bill_notifications
  DROP CONSTRAINT IF EXISTS bill_notifications_kind_check;

ALTER TABLE public.bill_notifications
  ADD CONSTRAINT bill_notifications_kind_check
  CHECK (kind IN ('due_soon', 'overdue', 'price_increase', 'charge_after_cancel', 'monthly_summary'));

-- =====================================================
-- SECAO 3: as duas regras de coerencia, agora com tres familias
-- =====================================================
-- (a) exatamente UMA referencia. A 016 escreveu isto como `<>` entre dois
--     booleanos, que e XOR e so funciona para dois. Com tres termos o XOR
--     encadeado ACEITA os tres preenchidos (true <> true <> true = true), que e
--     precisamente o caso que a regra existe para recusar. Por isso vira
--     contagem: soma quantas estao preenchidas e exige 1.
ALTER TABLE public.bill_notifications
  DROP CONSTRAINT IF EXISTS bill_notifications_one_reference_check;

ALTER TABLE public.bill_notifications
  ADD CONSTRAINT bill_notifications_one_reference_check
  CHECK (
    (CASE WHEN scheduled_transaction_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN recurrence_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN summary_month IS NOT NULL THEN 1 ELSE 0 END)
    = 1
  );

-- (b) a referencia combina com a familia do `kind`. Sem isto, um 'due_soon'
--     poderia nascer com `summary_month` no lugar de `scheduled_transaction_id`:
--     a linha entraria no sino e sumiria do `already_notified` da view
--     bill_alerts (que casa por scheduled_transaction_id), e o aviso de
--     vencimento sairia DE NOVO no dia seguinte.
ALTER TABLE public.bill_notifications
  DROP CONSTRAINT IF EXISTS bill_notifications_kind_reference_check;

ALTER TABLE public.bill_notifications
  ADD CONSTRAINT bill_notifications_kind_reference_check
  CHECK (
    (kind IN ('due_soon', 'overdue') AND scheduled_transaction_id IS NOT NULL)
    OR
    (kind IN ('price_increase', 'charge_after_cancel') AND recurrence_id IS NOT NULL)
    OR
    (kind = 'monthly_summary' AND summary_month IS NOT NULL)
  );

-- =====================================================
-- SECAO 4: o indice que impede o resumo duplicado
-- =====================================================
-- CHEIO, nao parcial -- ver o cabecalho. E a linha que torna seguro o cron do
-- dia 1 rodar duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS bill_notifications_summary_unique
  ON public.bill_notifications (user_id, kind, summary_month);

COMMENT ON INDEX public.bill_notifications_summary_unique IS
  'Deduplica o resumo mensal. Cheio (nao parcial) porque indice parcial nao serve de arbitro de ON CONFLICT pelo PostgREST -- ver o cabecalho do 016 e do 017. As linhas das outras familias tem summary_month NULL e nao colidem entre si.';

COMMENT ON TABLE public.bill_notifications IS
  'Avisos ja emitidos, das TRES familias: vencimento de conta prevista (scheduled_transaction_id), alerta de assinatura (recurrence_id) e resumo do mes fechado (summary_month). As tres chaves unicas sao o que impede repetir o mesmo aviso a cada passada do cron.';

-- =====================================================
-- SECAO 5: conferencia
-- =====================================================
-- Aplicar METADE e o pior resultado possivel: a coluna existiria, o cron
-- gravaria, e a deduplicacao -- a razao de ser do arquivo -- estaria faltando
-- sem nenhum sintoma ate o segundo resumo chegar no celular.
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.bill_notifications'::regclass
      AND attname = 'summary_month' AND attnum > 0 AND NOT attisdropped
  ) THEN
    problemas := problemas || E'\n  - coluna summary_month nao existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_kind_check'
      AND pg_get_constraintdef(oid) LIKE '%monthly_summary%'
  ) THEN
    problemas := problemas || E'\n  - o CHECK de kind nao admite monthly_summary';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_one_reference_check'
      AND pg_get_constraintdef(oid) LIKE '%summary_month%'
  ) THEN
    problemas := problemas || E'\n  - o CHECK de referencia exclusiva nao conhece summary_month';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_kind_reference_check'
      AND pg_get_constraintdef(oid) LIKE '%monthly_summary%'
  ) THEN
    problemas := problemas || E'\n  - o CHECK de coerencia entre kind e referencia nao conhece a familia do resumo';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_summary_month_check'
  ) THEN
    problemas := problemas || E'\n  - CHECK de primeiro-dia-do-mes ausente';
  END IF;

  -- Nao basta o indice existir: PARCIAL nao serve de arbitro de ON CONFLICT
  -- pelo PostgREST, e essa e a diferenca entre o cron funcionar e responder 500
  -- em toda execucao. `indpred IS NULL` e o que distingue os dois.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.bill_notifications'::regclass
      AND c.relname = 'bill_notifications_summary_unique'
      AND i.indisunique
      AND i.indpred IS NULL
  ) THEN
    problemas := problemas || E'\n  - indice unico do resumo ausente, nao-unico, ou PARCIAL (parcial nao serve de arbitro de ON CONFLICT)';
  END IF;

  -- As duas chaves das familias antigas tem que continuar de pe: sao elas que
  -- impedem o aviso de vencimento e o de assinatura de repetirem.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_unique'
  ) THEN
    problemas := problemas || E'\n  - a UNIQUE de conta prevista desapareceu';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.bill_notifications'::regclass
      AND c.relname = 'bill_notifications_recurrence_unique'
      AND i.indisunique
  ) THEN
    problemas := problemas || E'\n  - o indice unico de assinatura (016) desapareceu';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION E'017 aplicou parcialmente:%', problemas;
  END IF;

  RAISE NOTICE '017 conferido: summary_month, dominio de kind com tres familias, os dois CHECKs de coerencia e o indice unico CHEIO do resumo.';
END $$;

-- =====================================================
-- SECAO 6: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('017', '017_monthly_summary_notifications',
        'bill_notifications admite a terceira familia de aviso: o resumo do mes fechado - HMO-154', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
