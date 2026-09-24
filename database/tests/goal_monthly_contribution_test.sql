-- =====================================================
-- PULODOGATO - O ALVO MENSAL DA META (HMO-155 / migration 018)
-- =====================================================
-- Roda no db-verify, depois do 018. Prova no Postgres o que o teste de
-- TypeScript (scripts/test-safe-to-spend.mjs, 49 casos) nao alcanca: la a
-- aritmetica da reserva e exercitada com objetos em memoria, e nada impede que
-- o banco recuse -- ou devolva errado -- os dados que alimentam essa conta.
--
-- OS TRES ASSERTS QUE JUSTIFICAM O ARQUIVO
-- ----------------------------------------
--   1. A VIEW PUBLICA A COLUNA. `goal_progress` foi recriada com CREATE OR
--      REPLACE VIEW, copiando o corpo inteiro do 008 para acrescentar uma
--      coluna no fim. Se o campo nao chegar na view, a rota le `undefined`, o
--      alvo explicito vira NULL, a derivacao pelo prazo assume o lugar dele e
--      o desconto sai com OUTRO valor -- sem erro em lugar nenhum. E o tipo de
--      falha que so aparece como "o numero da tela esta estranho".
--
--   2. O CORPO COPIADO NAO PERDEU NADA. CREATE OR REPLACE VIEW impede remover
--      e reordenar coluna, mas NAO impede trocar a expressao de uma delas. Uma
--      copia errada de `monthly_required` ou de `saved` passaria pelo tsc,
--      pelo lint e pelos 49 testes de TypeScript, porque nenhum deles le a
--      view. Aqui o valor e conferido contra um numero calculado a mao.
--
--   3. O CHECK RECUSA ZERO E NEGATIVO. Alvo mensal negativo AUMENTARIA o
--      "quanto posso gastar" -- a meta viraria fonte de dinheiro. Isto e
--      constraint, nao validacao de rota: a rota pode ser contornada, e o
--      proprio PATCH /api/goals/:id grava o campo.
--
-- E o CONTROLE NEGATIVO, que e metade do valor: a meta sem alvo escolhido tem
-- que continuar com NULL, nao com 0. Um DEFAULT 0 no lugar do NULL apagaria a
-- diferenca entre "nao escolhi" e "escolhi zero" e, com ela, a derivacao pelo
-- prazo -- toda meta com prazo passaria a reservar nada, calada. Ver o
-- cabecalho da 018.
-- =====================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Cenario. auth.users vem do shim (database/tests/00_supabase_shim.sql).
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
VALUES ('cccccccc-0000-0000-0000-000000000001', 'meta-a@teste.local')
ON CONFLICT (id) DO NOTHING;

-- Meta com alvo ESCOLHIDO.
INSERT INTO public.financial_goals
  (id, user_id, title, target_amount, target_date, monthly_contribution, status)
VALUES
  ('cccccccc-1111-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001',
   'Viagem', 12000.00, (CURRENT_DATE + INTERVAL '10 months')::date, 800.00, 'active');

-- Meta SEM alvo escolhido, com prazo -- a que depende da derivacao.
INSERT INTO public.financial_goals
  (id, user_id, title, target_amount, target_date, status)
VALUES
  ('cccccccc-1111-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000001',
   'Reserva', 6000.00, (CURRENT_DATE + INTERVAL '5 months')::date, 'active');

-- Um aporte na primeira: o `saved` da view tem que enxergar isto, e e o numero
-- que o "ja aportado no mes" desconta do alvo do lado do TypeScript.
INSERT INTO public.goal_contributions (goal_id, user_id, amount, contributed_at)
VALUES ('cccccccc-1111-0000-0000-000000000001',
        'cccccccc-0000-0000-0000-000000000001', 2000.00, CURRENT_DATE);

-- ---------------------------------------------------------------------------
-- 1. A view publica monthly_contribution, com valor e com NULL.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  escolhido numeric;
  sem_escolha numeric;
  achou boolean;
BEGIN
  SELECT monthly_contribution INTO escolhido
    FROM public.goal_progress WHERE id = 'cccccccc-1111-0000-0000-000000000001';

  IF escolhido IS DISTINCT FROM 800.00 THEN
    RAISE EXCEPTION 'goal_progress.monthly_contribution veio % e devia ser 800.00', escolhido;
  END IF;

  -- O CONTROLE NEGATIVO: ausencia de escolha e NULL, nao 0. Se isto virar 0, a
  -- derivacao pelo prazo morre e ninguem percebe -- as metas simplesmente
  -- deixam de reservar.
  SELECT monthly_contribution, TRUE INTO sem_escolha, achou
    FROM public.goal_progress WHERE id = 'cccccccc-1111-0000-0000-000000000002';

  IF NOT COALESCE(achou, FALSE) THEN
    RAISE EXCEPTION 'a meta sem alvo escolhido sumiu da view goal_progress';
  END IF;

  IF sem_escolha IS NOT NULL THEN
    RAISE EXCEPTION 'meta sem alvo escolhido devia ter monthly_contribution NULL, veio %', sem_escolha;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. O corpo copiado do 008 continua calculando o que calculava.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_saved numeric;
  v_remaining numeric;
  v_months integer;
  v_required numeric;
  v_status text;
BEGIN
  SELECT saved, remaining, months_left, monthly_required, progress_status
    INTO v_saved, v_remaining, v_months, v_required, v_status
    FROM public.goal_progress WHERE id = 'cccccccc-1111-0000-0000-000000000001';

  IF v_saved <> 2000.00 THEN
    RAISE EXCEPTION 'saved veio % e devia ser 2000.00 (o LATERAL dos aportes se perdeu na copia)', v_saved;
  END IF;

  IF v_remaining <> 10000.00 THEN
    RAISE EXCEPTION 'remaining veio % e devia ser 10000.00', v_remaining;
  END IF;

  IF v_months <> 10 THEN
    RAISE EXCEPTION 'months_left veio % e devia ser 10', v_months;
  END IF;

  -- 10000 / 10 = 1000.00. E o numero que a tela de metas mostra como "voce
  -- precisa de R$ X por mes" e, quando nao ha alvo escolhido, e tambem o que o
  -- lib/safe-to-spend.ts reserva -- por isso os dois lados nao podem divergir.
  IF v_required <> 1000.00 THEN
    RAISE EXCEPTION 'monthly_required veio % e devia ser 1000.00', v_required;
  END IF;

  IF v_status <> 'on_track' THEN
    RAISE EXCEPTION 'progress_status veio % e devia ser on_track', v_status;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. O CHECK recusa zero e negativo, e aceita NULL.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    UPDATE public.financial_goals SET monthly_contribution = -100
     WHERE id = 'cccccccc-1111-0000-0000-000000000001';
    RAISE EXCEPTION 'alvo mensal NEGATIVO foi aceito -- a meta viraria fonte de dinheiro no "posso gastar"';
  EXCEPTION WHEN check_violation THEN
    NULL; -- esperado
  END;
END $$;

DO $$
BEGIN
  BEGIN
    UPDATE public.financial_goals SET monthly_contribution = 0
     WHERE id = 'cccccccc-1111-0000-0000-000000000001';
    RAISE EXCEPTION 'alvo mensal ZERO foi aceito -- ausencia de escolha ja tem representacao propria (NULL)';
  EXCEPTION WHEN check_violation THEN
    NULL; -- esperado
  END;
END $$;

-- NULL continua valendo: e como se apaga a escolha.
UPDATE public.financial_goals SET monthly_contribution = NULL
 WHERE id = 'cccccccc-1111-0000-0000-000000000001';

DO $$
BEGIN
  IF (SELECT monthly_contribution FROM public.goal_progress
       WHERE id = 'cccccccc-1111-0000-0000-000000000001') IS NOT NULL THEN
    RAISE EXCEPTION 'apagar a escolha (NULL) nao chegou na view';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. A view continua com security_invoker depois do CREATE OR REPLACE.
--    O view_security_invoker_test.sql varre o schema inteiro e tambem pegaria
--    isto; o assert aqui e nominal para a falha citar a migration 018 em vez de
--    aparecer como "mais uma view sem a opcao" numa lista.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.goal_progress'::regclass
      AND reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE EXCEPTION '018 recriou goal_progress e perdeu o security_invoker: a view passa a rodar como o dono e a meta de qualquer usuario volta para qualquer usuario logado';
  END IF;
END $$;

ROLLBACK;
