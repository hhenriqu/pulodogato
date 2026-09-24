-- =====================================================
-- PULODOGATO - AVISO DE ASSINATURA: O "JA AVISEI" DOS ALERTAS DE RECORRENCIA
-- =====================================================
-- Migration: 016_recurrence_notifications
-- Gerado em: 2026-09-24  (HMO-148)
--
-- O QUE FALTAVA
-- -------------
-- Os dois alertas do detector -- preco subiu mais de 10%, e cobranca depois de
-- marcada como cancelada -- ja sao CALCULADOS (lib/recurrence-detector.ts) e
-- aparecem na tela /dashboard/recurrences. O que nao existia era o DISPARO:
-- push e sino.
--
-- Disparar exige uma coisa que o calculo nao tem: o estado "ja avisei ESTE
-- usuario sobre ESTE alerta". Sem ele o aviso sai de novo a cada varredura --
-- e a varredura roda no cron diario E ao fim de cada importacao de extrato
-- (HMO-147). Quem importa tres extratos numa tarde recebe o mesmo "a Netflix
-- subiu 12%" tres vezes. O app vira spam e o usuario desliga a notificacao, o
-- que apaga junto o aviso de vencimento, que e o que ele mais precisa.
--
-- POR QUE A REGRA CONTINUA EM TYPESCRIPT E SO O "JA AVISEI" VEM PARA O BANCO
-- --------------------------------------------------------------------------
-- Reescrever "subiu mais de 10% em relacao a media das ANTERIORES" numa view
-- criaria DUAS definicoes do mesmo alerta -- a de lib/recurrence-detector.ts,
-- que tem teste, e a daqui. Duas definicoes do mesmo numero e o erro que o
-- cabecalho da monthly_cash_flow (008) existe para nao repetir: as duas
-- parecem certas e divergem na primeira correcao aplicada em so uma delas.
--
-- Entao o banco guarda so o fato consumado: "em tal data, avisei tal pessoa
-- sobre tal recorrencia". Isso nenhum TypeScript guarda, porque o processo que
-- avisa morre no fim do request.
--
-- POR QUE GENERALIZAR bill_notifications E NAO CRIAR UMA SEGUNDA TABELA
-- ---------------------------------------------------------------------
-- O sino do app e UMA lista. Com duas tabelas, cada consumidor (o sino, o
-- contador de nao-lidos, o "marcar como lido") teria que ler as duas e
-- intercalar por data -- e o dia em que alguem esquecer a segunda tabela num
-- desses lugares produz um sino que mostra 2 avisos e um contador que diz 5.
-- Uma tabela so, com duas familias de `kind`, faz o PATCH /api/notifications/[id]
-- que ja existe funcionar para os avisos novos sem uma linha de codigo.
--
-- O PRECO: a tabela passa a ter duas referencias opcionais no lugar de uma
-- obrigatoria, e e por isso que as SECOES 3 e 4 existem.
--
-- =====================================================
-- A ARMADILHA QUE ESTA MIGRATION EVITA -- LEIA ANTES DE MEXER NO INDICE
-- =====================================================
-- O desenho da issue pedia um indice unico PARCIAL:
--
--   CREATE UNIQUE INDEX ... ON bill_notifications (recurrence_id, kind, reference_date)
--     WHERE recurrence_id IS NOT NULL;
--
-- O raciocinio estava certo (a UNIQUE antiga nao deduplica linha de
-- recorrencia, porque NULL nao colide com NULL). A FORMA e que nao serve, e o
-- motivo nao aparece em lugar nenhum ate o cron rodar em producao:
--
-- **Um indice unico parcial nao pode ser inferido como arbitro de ON CONFLICT
-- sem repetir o predicado do indice na propria clausula.** Conferido em
-- PostgreSQL 17:
--
--   INSERT ... ON CONFLICT (recurrence_id, kind, reference_date) DO NOTHING
--   -- com indice PARCIAL:
--   ERROR: there is no unique or exclusion constraint matching the ON CONFLICT
--          specification
--
--   INSERT ... ON CONFLICT (recurrence_id, kind, reference_date)
--     WHERE recurrence_id IS NOT NULL DO NOTHING
--   -- passa.
--
-- E o `onConflict:` do supabase-js/PostgREST aceita uma LISTA DE COLUNAS. Nao
-- existe jeito de mandar o `WHERE` do indice por ali. Com o indice parcial, a
-- rota /api/cron/recurrence-alerts responderia 500 em toda execucao e ninguem
-- receberia aviso nenhum -- e o sintoma ("falha ao gravar os avisos") nao
-- aponta para o indice.
--
-- Por isso o indice aqui e CHEIO. O que se perde e uma entrada de indice por
-- linha de conta prevista (recurrence_id NULL); o que se ganha e um upsert que
-- funciona pelo cliente que o projeto realmente usa. E o indice cheio dedupica
-- exatamente igual para a familia de recorrencia, porque duas linhas de conta
-- prevista com `recurrence_id` NULL nunca colidem entre si -- NULL nao e igual
-- a NULL em indice unico. Conferido nos tres casos em
-- database/tests/recurrence_notifications_test.sql.
--
-- REFERENCE_DATE DE UMA RECORRENCIA = last_charge_date
-- ---------------------------------------------------
-- Mesma ideia do `due_date` na familia de conta prevista: a chave unica inclui
-- uma data para que um FATO NOVO mereca um aviso novo. Adiar a conta gera
-- aviso novo; uma cobranca nova da assinatura tambem. Se a chave fosse so
-- (recurrence_id, kind), o usuario seria avisado do aumento uma unica vez na
-- vida daquela assinatura -- o reajuste do ano seguinte passaria calado.
--
-- SEM META-COMANDO DE psql AQUI -- ESTE ARQUIVO E COLADO NO SQL EDITOR
-- ---------------------------------------------------------------------
-- Producao nao tem runner de migration: quem aplica e uma pessoa, colando o
-- arquivo no SQL Editor do Supabase, que fala Postgres e NAO e o psql. Uma
-- linha comecando com barra invertida vira `syntax error at or near "\"`, e
-- como ela estava ANTES do primeiro comando executavel, NADA era aplicado --
-- nem a coluna, nem os CHECKs, nem o indice. O arquivo parecia rodado e o
-- banco nao mudava. Foi exatamente o que aconteceu com a 015 (HMO-149,
-- 2026-09-24); este arquivo tinha o mesmo defeito e ainda nao havia sido
-- aplicado em producao, entao ia falhar do mesmo jeito na vez dele.
--
-- O CI ja passa ON_ERROR_STOP pela linha de comando (`psql -v
-- ON_ERROR_STOP=1`), entao declara-lo aqui dentro nao acrescentava nada la.
-- E a seguranca nao dependia dele: o arquivo inteiro esta num BEGIN/COMMIT.
-- Erro no meio aborta a transacao, todo comando seguinte falha com "current
-- transaction is aborted" e o COMMIT final vira ROLLBACK -- aplicar pela
-- metade continua impossivel, e a SECAO 6 ainda confere objeto por objeto e
-- da RAISE EXCEPTION se faltar alguma coisa.
--
-- scripts/check-migrations-in-ci.mjs agora reprova qualquer migration nova com
-- meta-comando, para que isto nao volte numa terceira.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: pre-requisitos
-- =====================================================
-- Sem isto a migration falha mais adiante com "relation does not exist", que
-- nao diz QUAL migration ficou para tras.
DO $$
BEGIN
  IF to_regclass('public.bill_notifications') IS NULL THEN
    RAISE EXCEPTION '016 exige public.bill_notifications (migration 009) -- aplique o 009 primeiro.';
  END IF;

  IF to_regclass('public.detected_recurrences') IS NULL THEN
    RAISE EXCEPTION '016 exige public.detected_recurrences (migration 011) -- aplique o 011 primeiro.';
  END IF;
END $$;

-- =====================================================
-- SECAO 1: a referencia deixa de ser obrigatoria
-- =====================================================
-- Um aviso de recorrencia nao tem conta prevista. Enquanto a coluna for
-- NOT NULL, a unica saida seria inventar um valor -- e a alternativa comum
-- (apontar para uma conta prevista qualquer) faz o clique no sino levar o
-- usuario para a conta errada.
ALTER TABLE public.bill_notifications
  ALTER COLUMN scheduled_transaction_id DROP NOT NULL;

-- =====================================================
-- SECAO 2: a referencia nova
-- =====================================================
-- ON DELETE CASCADE: apagada a recorrencia, o aviso perde o destino do clique.
-- Manter a linha deixaria um item no sino que abre uma tela vazia.
ALTER TABLE public.bill_notifications
  ADD COLUMN IF NOT EXISTS recurrence_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_recurrence_id_fkey'
  ) THEN
    ALTER TABLE public.bill_notifications
      ADD CONSTRAINT bill_notifications_recurrence_id_fkey
      FOREIGN KEY (recurrence_id) REFERENCES public.detected_recurrences(id) ON DELETE CASCADE;
  END IF;
END $$;

COMMENT ON COLUMN public.bill_notifications.recurrence_id IS
  'A assinatura que originou o aviso, quando kind e da familia de recorrencia. Exclusivo com scheduled_transaction_id -- ver o CHECK.';

-- =====================================================
-- SECAO 3: o dominio de `kind` cresce
-- =====================================================
-- O CHECK antigo so admitia 'due_soon' e 'overdue'. Sem trocar por este, o
-- INSERT do cron novo seria recusado pela constraint -- o que, ao menos, e uma
-- falha visivel. O que NAO se pode fazer e largar o dominio aberto: `kind` e o
-- que a tela e o push usam para escolher icone e para onde o clique leva, e um
-- `kind` digitado errado viraria uma linha invisivel em vez de um erro.
ALTER TABLE public.bill_notifications
  DROP CONSTRAINT IF EXISTS bill_notifications_kind_check;

ALTER TABLE public.bill_notifications
  ADD CONSTRAINT bill_notifications_kind_check
  CHECK (kind IN ('due_soon', 'overdue', 'price_increase', 'charge_after_cancel'));

-- =====================================================
-- SECAO 4: exatamente UMA referencia, e coerente com o `kind`
-- =====================================================
-- Sao duas constraints porque sao dois erros diferentes, e um nome de
-- constraint que aparece no log de producao deve dizer qual dos dois aconteceu.
--
-- (a) exatamente uma referencia preenchida. Nenhuma das duas = aviso orfao:
--     aparece no sino e o clique nao tem para onde ir. As duas = o clique tem
--     dois destinos e quem escolhe passa a ser a ordem do `if` no componente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_one_reference_check'
  ) THEN
    ALTER TABLE public.bill_notifications
      ADD CONSTRAINT bill_notifications_one_reference_check
      CHECK (
        (scheduled_transaction_id IS NOT NULL) <> (recurrence_id IS NOT NULL)
      );
  END IF;
END $$;

-- (b) a referencia combina com a familia do `kind`. O (a) sozinho aceita um
--     'due_soon' apontando para uma recorrencia: a linha nasce valida, entra
--     no sino, e desaparece do `already_notified` da view bill_alerts (que
--     casa por scheduled_transaction_id) -- ou seja, o aviso de vencimento
--     sairia DE NOVO no dia seguinte. Um aviso repetido por causa de uma linha
--     que o banco aceitou e exatamente a falha que esta issue existe para
--     fechar, entao a regra vira constraint em vez de convencao.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_kind_reference_check'
  ) THEN
    ALTER TABLE public.bill_notifications
      ADD CONSTRAINT bill_notifications_kind_reference_check
      CHECK (
        (kind IN ('due_soon', 'overdue') AND scheduled_transaction_id IS NOT NULL)
        OR
        (kind IN ('price_increase', 'charge_after_cancel') AND recurrence_id IS NOT NULL)
      );
  END IF;
END $$;

-- =====================================================
-- SECAO 5: o indice que impede o aviso repetido
-- =====================================================
-- Ver "A ARMADILHA" no cabecalho para o porque de ele ser CHEIO e nao parcial.
-- Esta e a linha que faz o cron poder rodar dez vezes por dia -- e depois de
-- cada importacao de extrato -- sem avisar duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS bill_notifications_recurrence_unique
  ON public.bill_notifications (recurrence_id, kind, reference_date);

COMMENT ON INDEX public.bill_notifications_recurrence_unique IS
  'Deduplica o aviso de assinatura. Cheio (nao parcial) porque indice parcial nao serve de arbitro de ON CONFLICT pelo PostgREST -- ver o cabecalho do 016.';

COMMENT ON TABLE public.bill_notifications IS
  'Avisos ja emitidos, das DUAS familias: vencimento de conta prevista (scheduled_transaction_id) e alerta de assinatura (recurrence_id). As duas UNIQUEs sao o que impede repetir o mesmo aviso a cada varredura.';

-- =====================================================
-- SECAO 6: conferencia
-- =====================================================
-- Uma migration que aplica METADE e o pior resultado possivel aqui: a coluna
-- existiria, o cron gravaria, e a deduplicacao -- a razao de ser do arquivo --
-- estaria faltando sem nenhum sintoma ate o segundo aviso chegar no celular.
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.bill_notifications'::regclass
      AND attname = 'scheduled_transaction_id'
      AND attnotnull
  ) THEN
    problemas := problemas || E'\n  - scheduled_transaction_id continua NOT NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.bill_notifications'::regclass
      AND attname = 'recurrence_id' AND attnum > 0 AND NOT attisdropped
  ) THEN
    problemas := problemas || E'\n  - coluna recurrence_id nao existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_recurrence_id_fkey' AND confdeltype = 'c'
  ) THEN
    problemas := problemas || E'\n  - FK de recurrence_id ausente ou sem ON DELETE CASCADE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_kind_check'
      AND pg_get_constraintdef(oid) LIKE '%price_increase%'
      AND pg_get_constraintdef(oid) LIKE '%charge_after_cancel%'
  ) THEN
    problemas := problemas || E'\n  - o CHECK de kind nao admite as duas familias novas';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_one_reference_check'
  ) THEN
    problemas := problemas || E'\n  - CHECK de referencia exclusiva ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_kind_reference_check'
  ) THEN
    problemas := problemas || E'\n  - CHECK de coerencia entre kind e referencia ausente';
  END IF;

  -- Nao basta o indice existir: PARCIAL nao serve de arbitro de ON CONFLICT
  -- pelo PostgREST, e essa e a diferenca entre o cron funcionar e responder
  -- 500 em toda execucao. `indpred IS NULL` e o que distingue os dois.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.bill_notifications'::regclass
      AND c.relname = 'bill_notifications_recurrence_unique'
      AND i.indisunique
      AND i.indpred IS NULL
  ) THEN
    problemas := problemas || E'\n  - indice unico de deduplicacao ausente, nao-unico, ou PARCIAL (parcial nao serve de arbitro de ON CONFLICT)';
  END IF;

  -- A UNIQUE da familia de conta prevista tem que continuar de pe: e ela que
  -- impede o aviso de vencimento de repetir.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_unique'
  ) THEN
    problemas := problemas || E'\n  - a UNIQUE de conta prevista desapareceu';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION E'016 aplicou parcialmente:%', problemas;
  END IF;

  RAISE NOTICE '016 conferido: referencia opcional, recurrence_id com CASCADE, dominio de kind, os dois CHECKs e o indice unico CHEIO de deduplicacao.';
END $$;

-- =====================================================
-- SECAO 7: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('016', '016_recurrence_notifications',
        'bill_notifications passa a guardar tambem o "ja avisei" dos alertas de assinatura - HMO-148', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
