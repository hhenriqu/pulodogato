-- =====================================================
-- PULODOGATO - O RESUMO DO MES NAO SAI DUAS VEZES (HMO-154 / migration 017)
-- =====================================================
-- Roda no db-verify, depois do 017. Prova no Postgres o que nenhum teste de
-- TypeScript com cliente dublado alcanca.
--
-- O ASSERT QUE JUSTIFICA O ARQUIVO
-- --------------------------------
-- O cron do resumo grava com `ON CONFLICT (user_id, kind, summary_month)` --
-- lista de colunas NUA, que e tudo o que o PostgREST sabe mandar. Essa
-- clausula tem que RESOLVER contra o indice do 017. Se alguem trocar o indice
-- por um PARCIAL (`WHERE summary_month IS NOT NULL`, que e a forma que parece
-- mais limpa e que o desenho original pediria), o Postgres passa a responder
--   ERROR: there is no unique or exclusion constraint matching the ON CONFLICT
--          specification
-- em TODA execucao do cron, ninguem recebe resumo nenhum, e a mensagem nao
-- aponta para o indice. So o Postgres pega isso -- por isso este arquivo.
--
-- E os CONTROLES NEGATIVOS, que sao metade do valor do teste:
--   - o resumo do mes SEGUINTE tem que gerar linha nova (senao um indice sem o
--     mes passaria verde aqui e o usuario receberia um unico resumo na vida);
--   - dois usuarios diferentes tem que poder receber o resumo do mesmo mes;
--   - as familias antigas (conta prevista, assinatura) tem que continuar
--     gravando normalmente -- e em particular duas contas vencendo NO MESMO DIA
--     continuam gerando DOIS avisos. Um indice ingenuo sobre
--     (user_id, kind, reference_date) recusaria o segundo, e o usuario deixaria
--     de ser avisado de uma conta que vence hoje. Trocar aviso repetido por
--     aviso PERDIDO e o erro caro dos dois, e e o motivo de `summary_month`
--     existir como coluna separada.
-- =====================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Cenario minimo. auth.users vem do shim (database/tests/00_supabase_shim.sql).
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'resumo-a@teste.local'),
       ('aaaaaaaa-0000-0000-0000-000000000002', 'resumo-b@teste.local')
ON CONFLICT (id) DO NOTHING;

-- O cron roda com service_role, que nao passa pela RLS. Aqui o papel da sessao
-- e o dono, entao a RLS nao se aplica -- este teste e sobre as CONSTRAINTS e o
-- indice, nao sobre isolamento (isso e do rls_isolation_test.sql).

-- ---------------------------------------------------------------------------
-- 1. O caminho feliz: o resumo entra.
-- ---------------------------------------------------------------------------
INSERT INTO public.bill_notifications
  (user_id, kind, reference_date, summary_month, title, body)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'monthly_summary', '2026-09-01', '2026-09-01',
   'Setembro fechou', 'Entrou R$ 8.000,00 e saiu R$ 6.000,00.');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.bill_notifications WHERE kind = 'monthly_summary') <> 1 THEN
    RAISE EXCEPTION 'o resumo do mes nao entrou na tabela';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. O ASSERT PRINCIPAL: a lista de colunas nua resolve contra o indice.
--    Com indice PARCIAL este comando aborta com "no unique or exclusion
--    constraint matching the ON CONFLICT specification".
-- ---------------------------------------------------------------------------
INSERT INTO public.bill_notifications
  (user_id, kind, reference_date, summary_month, title, body)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'monthly_summary', '2026-09-01', '2026-09-01',
   'Setembro fechou (segunda passada do cron)', 'Nao pode virar linha nova.')
ON CONFLICT (user_id, kind, summary_month) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.bill_notifications WHERE kind = 'monthly_summary') <> 1 THEN
    RAISE EXCEPTION 'a segunda passada do cron duplicou o resumo -- a deduplicacao nao esta de pe';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Controle negativo: outro MES e fato novo e merece resumo novo.
-- ---------------------------------------------------------------------------
INSERT INTO public.bill_notifications
  (user_id, kind, reference_date, summary_month, title, body)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'monthly_summary', '2026-10-01', '2026-10-01',
   'Outubro fechou', 'Outro mes.')
ON CONFLICT (user_id, kind, summary_month) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.bill_notifications WHERE kind = 'monthly_summary') <> 2 THEN
    RAISE EXCEPTION 'o resumo de outubro nao entrou -- o mes nao esta na chave unica';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Controle negativo: outro USUARIO recebe o resumo do mesmo mes.
-- ---------------------------------------------------------------------------
INSERT INTO public.bill_notifications
  (user_id, kind, reference_date, summary_month, title, body)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000002', 'monthly_summary', '2026-09-01', '2026-09-01',
   'Setembro fechou', 'Outro usuario.')
ON CONFLICT (user_id, kind, summary_month) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.bill_notifications WHERE kind = 'monthly_summary') <> 3 THEN
    RAISE EXCEPTION 'o segundo usuario nao recebeu o resumo -- o user_id nao esta na chave unica';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. As constraints recusam a linha errada. Uma por uma, com SAVEPOINT, porque
--    um erro sem savepoint aborta a transacao e os testes seguintes falhariam
--    com "current transaction is aborted" -- que nao prova nada.
-- ---------------------------------------------------------------------------

-- 5a. Resumo sem `summary_month`: a familia perde a propria chave, e o indice
--     unico deixaria de deduplicar (NULL nao colide com NULL) -- o resumo
--     repetiria a cada passada. E exatamente o que o arquivo existe para impedir.
SAVEPOINT s1;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.bill_notifications
      (user_id, kind, reference_date, summary_month, title, body)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'monthly_summary', '2026-11-01', NULL, 't', 'b');
    RAISE EXCEPTION 'FALHOU: monthly_summary sem summary_month foi aceito';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- esperado
  END;
END $$;
ROLLBACK TO SAVEPOINT s1;

-- 5b. Resumo apontando TAMBEM para uma conta prevista: duas referencias. O
--     clique no sino passaria a ter dois destinos e quem escolhe seria a ordem
--     do `if` no componente.
SAVEPOINT s2;
DO $$
DECLARE
  algum_agendado uuid;
BEGIN
  SELECT id INTO algum_agendado FROM public.scheduled_transactions LIMIT 1;
  IF algum_agendado IS NULL THEN
    -- Sem conta prevista no banco de teste nao da para montar o caso; o 5c
    -- cobre o mesmo CHECK por outro caminho.
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.bill_notifications
      (user_id, kind, reference_date, summary_month, scheduled_transaction_id, title, body)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'monthly_summary', '2026-11-01',
            '2026-11-01', algum_agendado, 't', 'b');
    RAISE EXCEPTION 'FALHOU: linha com DUAS referencias foi aceita';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- esperado
  END;
END $$;
ROLLBACK TO SAVEPOINT s2;

-- 5c. Aviso de vencimento usando `summary_month` no lugar da conta prevista.
--     A linha nasceria valida, entraria no sino, e sumiria do `already_notified`
--     da view bill_alerts (que casa por scheduled_transaction_id) -- o aviso de
--     vencimento sairia DE NOVO no dia seguinte, todo dia.
SAVEPOINT s3;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.bill_notifications
      (user_id, kind, reference_date, summary_month, title, body)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'due_soon', '2026-11-01', '2026-11-01', 't', 'b');
    RAISE EXCEPTION 'FALHOU: due_soon com summary_month foi aceito';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- esperado
  END;
END $$;
ROLLBACK TO SAVEPOINT s3;

-- 5d. `kind` fora do dominio. O dominio e fechado de proposito: um `kind`
--     digitado errado tem que virar erro, nao uma linha invisivel no sino.
SAVEPOINT s4;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.bill_notifications
      (user_id, kind, reference_date, summary_month, title, body)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'resumo_mensal', '2026-11-01', '2026-11-01', 't', 'b');
    RAISE EXCEPTION 'FALHOU: kind fora do dominio foi aceito';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- esperado
  END;
END $$;
ROLLBACK TO SAVEPOINT s4;

-- 5e. `summary_month` que nao e o primeiro dia do mes. Duas execucoes do mesmo
--     mes gravariam datas diferentes, nao colidiriam no indice, e o resumo
--     repetiria -- a falha que este arquivo inteiro existe para fechar.
SAVEPOINT s5;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.bill_notifications
      (user_id, kind, reference_date, summary_month, title, body)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'monthly_summary', '2026-11-15', '2026-11-15', 't', 'b');
    RAISE EXCEPTION 'FALHOU: summary_month no meio do mes foi aceito';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- esperado
  END;
END $$;
ROLLBACK TO SAVEPOINT s5;

-- ---------------------------------------------------------------------------
-- 6. A FAMILIA ANTIGA CONTINUA INTACTA -- o controle negativo que mais importa.
--    Duas contas previstas que vencem NO MESMO DIA geram DOIS avisos do mesmo
--    usuario. Um indice unico ingenuo sobre (user_id, kind, reference_date)
--    recusaria o segundo, e o usuario deixaria de ser avisado de uma conta que
--    vence hoje -- sem nada no log dizendo por que.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  conta_a uuid;
  conta_b uuid;
  quantos int;
BEGIN
  SELECT id INTO conta_a FROM public.scheduled_transactions ORDER BY id LIMIT 1;
  SELECT id INTO conta_b FROM public.scheduled_transactions ORDER BY id OFFSET 1 LIMIT 1;

  IF conta_a IS NULL OR conta_b IS NULL THEN
    RAISE NOTICE 'sem duas contas previstas no banco de teste -- o caso das duas vencendo no mesmo dia nao pode ser montado aqui';
    RETURN;
  END IF;

  INSERT INTO public.bill_notifications
    (user_id, scheduled_transaction_id, kind, reference_date, title, body)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', conta_a, 'due_soon', '2026-09-30', 'Conta A', 'vence hoje'),
         ('aaaaaaaa-0000-0000-0000-000000000001', conta_b, 'due_soon', '2026-09-30', 'Conta B', 'vence hoje');

  SELECT count(*) INTO quantos
    FROM public.bill_notifications
   WHERE kind = 'due_soon' AND reference_date = '2026-09-30';

  IF quantos <> 2 THEN
    RAISE EXCEPTION 'duas contas vencendo no mesmo dia geraram % aviso(s) -- o indice do 017 esta engolindo aviso da familia antiga', quantos;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. O indice do resumo e CHEIO. `indpred IS NULL` e o que distingue cheio de
--    parcial, e e a diferenca entre o cron funcionar e responder 500 sempre.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.bill_notifications'::regclass
      AND c.relname = 'bill_notifications_summary_unique'
      AND i.indisunique
      AND i.indpred IS NULL
  ) THEN
    RAISE EXCEPTION 'o indice do resumo sumiu, deixou de ser unico, ou virou PARCIAL';
  END IF;
END $$;

ROLLBACK;
