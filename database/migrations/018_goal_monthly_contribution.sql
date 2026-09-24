-- =====================================================
-- PULODOGATO - O APORTE DE META ENTRA NO "QUANTO POSSO GASTAR"
-- =====================================================
-- Migration: 018_goal_monthly_contribution
-- Gerado em: 2026-09-24  (HMO-155)
--
-- O BURACO, E ELE FOI DEIXADO DE PROPOSITO
-- ----------------------------------------
-- O cabecalho do lib/safe-to-spend.ts termina listando o que a conta NAO sabe,
-- e o ultimo item e este: "reserva de metas -- aporte de meta ainda nao tem
-- alvo mensal no schema, entao nao ha o que descontar sem inventar semantica".
--
-- A consequencia na tela: o app diz que ha R$ 1.200 livres para o mes
-- exatamente para quem planejava separar R$ 800 deles. O numero nao esta
-- errado por pouco -- ele responde outra pergunta.
--
-- Este arquivo fecha o buraco pelo lado do schema. A aritmetica fica no
-- TypeScript (lib/safe-to-spend.ts, funcao pura com teste), como as outras
-- quatro parcelas.
--
-- =====================================================
-- A DECISAO: VALOR EXPLICITO MANDA, PRAZO E O PLANO B
-- =====================================================
-- A issue deixava as duas portas abertas -- alvo mensal explicito ou derivado
-- de target_amount, saved e target_date -- e pedia que a escolha ficasse
-- registrada AQUI, nao so no PR. Registrada:
--
--   `monthly_contribution` e a fonte da verdade. Quando ela e NULL e a meta tem
--   `target_date`, o alvo do mes e DERIVADO -- e derivado pela mesma formula
--   que a view ja publica em `monthly_required`, isto e, o que falta dividido
--   pelos meses que restam. Sem valor e sem prazo, a meta reserva ZERO.
--
-- Por que nao so explicito: ninguem tem esse campo preenchido hoje. Um desconto
-- que exige cadastro manual em cada meta entrega uma feature que nao muda nada
-- na tela de quem ja usa o app.
--
-- Por que nao so derivado: "juntar 15 mil" e uma meta valida sem data -- esta
-- escrito no comentario da propria coluna `target_date` no 008. So derivar
-- deixaria essa meta reservando nada para sempre, sem lugar onde consertar.
--
-- Por que a derivacao copia `monthly_required` em vez de inventar formula: a
-- tela de metas JA mostra ao usuario "voce precisa de R$ X por mes". Reservar
-- um numero diferente do que a tela promete seriam duas versoes da mesma regra
-- dentro do mesmo app, e a segunda deixa de acompanhar a primeira no dia em que
-- alguem mexer numa delas.
--
-- Por que a coluna e NULL-avel e nao tem DEFAULT: NULL aqui quer dizer "nao
-- escolhi", que e diferente de "escolhi zero". Um DEFAULT 0 apagaria a
-- distincao e, com ela, o plano B -- toda meta com prazo passaria a reservar
-- nada, calada.
--
-- =====================================================
-- O QUE ESTE ARQUIVO NAO FAZ, E POR QUE
-- =====================================================
-- NAO desconta meta de GRUPO. `financial_goals.group_id` existe e a RLS do 008
-- devolve as metas dos grupos do usuario junto com as dele. O alvo mensal de
-- uma meta de grupo e do GRUPO: descontar o valor cheio da carteira de cada
-- membro faria tres pessoas reservarem R$ 900 para uma meta de R$ 300 por mes,
-- e as tres veriam o "posso gastar" cair pelo dinheiro das outras duas. Ratear
-- e o problema do acerto de grupo (007), nao deste arquivo. A rota filtra
-- `group_id IS NULL` e o teste registra a exclusao.
--
-- NAO cria tabela de "reserva do mes". A reserva e derivada de fatos que ja
-- existem (o alvo e os aportes do mes) e muda a cada aporte lancado. Uma tabela
-- precisaria de trigger em goal_contributions para nao mentir -- mesma razao
-- pela qual nao existe tabela de "posso gastar", escrita no topo da rota.
--
-- =====================================================
-- SEM META-COMANDO DE psql AQUI -- ESTE ARQUIVO E COLADO NO SQL EDITOR
-- =====================================================
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
-- Falhar aqui, com nome, e melhor do que falhar em "relation does not exist" na
-- SECAO 2 -- essa mensagem nao diz QUAL migration ficou para tras.
DO $$
BEGIN
  IF to_regclass('public.financial_goals') IS NULL THEN
    RAISE EXCEPTION '018 exige a 008 aplicada: public.financial_goals nao existe.';
  END IF;

  IF to_regclass('public.goal_contributions') IS NULL THEN
    RAISE EXCEPTION '018 exige a 008 aplicada: public.goal_contributions nao existe.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = to_regclass('public.goal_progress') AND relkind = 'v'
  ) THEN
    RAISE EXCEPTION '018 exige a 008 aplicada: a view public.goal_progress nao existe.';
  END IF;
END $$;

-- =====================================================
-- SECAO 1: o alvo mensal da meta
-- =====================================================
ALTER TABLE public.financial_goals
  ADD COLUMN IF NOT EXISTS monthly_contribution numeric(15,2);

COMMENT ON COLUMN public.financial_goals.monthly_contribution IS
  'Quanto o usuario quer separar por mes para esta meta. NULL = nao escolheu; nesse caso o "quanto posso gastar" deriva o alvo do prazo (mesma formula de goal_progress.monthly_required) e, sem prazo, reserva zero.';

-- Zero e negativo ficam de fora pelo mesmo motivo que `goal_contributions.amount
-- > 0` no 008: um alvo mensal negativo AUMENTARIA o "posso gastar" -- a meta
-- viraria fonte de dinheiro. E `0` nao e um valor escolhido, e a ausencia de
-- escolha, que ja tem representacao propria (NULL).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.financial_goals'::regclass
      AND conname = 'financial_goals_monthly_contribution_check'
  ) THEN
    ALTER TABLE public.financial_goals
      ADD CONSTRAINT financial_goals_monthly_contribution_check
      CHECK (monthly_contribution IS NULL OR monthly_contribution > (0)::numeric);
  END IF;
END $$;

-- =====================================================
-- SECAO 2: a view publica o campo novo
-- =====================================================
-- O corpo abaixo e o do 008 sem uma virgula trocada; a UNICA diferenca e a
-- coluna `monthly_contribution` no fim do SELECT. CREATE OR REPLACE VIEW nao
-- aceita remover nem reordenar coluna -- so acrescentar no fim --, entao
-- repetir o corpo inteiro e o preco de nao usar DROP VIEW (que derrubaria os
-- GRANTs e o security_invoker junto).
CREATE OR REPLACE VIEW public.goal_progress AS
  SELECT
    g.id,
    g.user_id,
    g.group_id,
    g.account_id,
    g.title,
    g.description,
    g.target_amount,
    g.target_date,
    g.status,
    g.color_hex,
    g.icon,
    g.created_at,
    g.updated_at,
    COALESCE(c.saved, 0)::numeric(15,2) AS saved,
    -- nunca negativo: quem passou da meta ve "faltam R$ 0,00", nao um valor
    -- negativo que a tela formataria como "-R$ 300,00 restantes".
    GREATEST(g.target_amount - COALESCE(c.saved, 0), 0)::numeric(15,2) AS remaining,
    -- 4 casas; a tela arredonda. O CHECK garante target_amount > 0.
    ROUND(COALESCE(c.saved, 0) / g.target_amount, 4) AS progress_ratio,
    COALESCE(c.contribution_count, 0) AS contribution_count,
    c.last_contribution_at,
    d.months_left,
    CASE
      WHEN g.target_date IS NULL THEN NULL
      WHEN COALESCE(c.saved, 0) >= g.target_amount THEN 0::numeric(15,2)
      ELSE ROUND(
        (g.target_amount - COALESCE(c.saved, 0)) / GREATEST(d.months_left, 1),
        2)::numeric(15,2)
    END AS monthly_required,
    -- Estado calculado na leitura, separado de g.status (que o usuario controla
    -- ao pausar ou cancelar). 'reached' aparece sozinho quando os aportes
    -- alcancam o alvo: sem isso a meta ficaria "em andamento" com barra cheia
    -- ate alguem lembrar de marcar como concluida na mao.
    CASE
      WHEN g.status IN ('paused', 'cancelled') THEN g.status
      WHEN COALESCE(c.saved, 0) >= g.target_amount THEN 'reached'
      WHEN g.target_date IS NOT NULL AND g.target_date < CURRENT_DATE THEN 'overdue'
      ELSE 'on_track'
    END AS progress_status,
    -- A COLUNA NOVA (018). Vai crua para o cliente: quem decide entre ela e a
    -- derivacao pelo prazo e o lib/safe-to-spend.ts, que tem teste. Se a regra
    -- tambem morasse aqui, existiriam duas.
    g.monthly_contribution
  FROM public.financial_goals g
  LEFT JOIN LATERAL (
    SELECT SUM(gc.amount) AS saved,
           COUNT(*) AS contribution_count,
           MAX(gc.contributed_at) AS last_contribution_at
    FROM public.goal_contributions gc
    WHERE gc.goal_id = g.id
  ) AS c ON TRUE
  -- meses cheios entre o mes corrente e o mes do prazo, NULL sem prazo.
  -- Calculado uma vez num LATERAL porque monthly_required precisa do mesmo
  -- numero: duplicar a expressao e como duas versoes da mesma regra, e a
  -- segunda deixa de acompanhar a primeira na primeira vez que alguem mexer.
  -- O ::integer nao e cosmetico -- date_part() devolve double precision, e
  -- ROUND(double, int) nao existe no Postgres: a view nem chega a ser criada.
  LEFT JOIN LATERAL (
    SELECT CASE
             WHEN g.target_date IS NULL THEN NULL
             ELSE GREATEST(
               (date_part('year',  g.target_date) - date_part('year',  CURRENT_DATE)) * 12
                 + (date_part('month', g.target_date) - date_part('month', CURRENT_DATE)),
               0)::integer
           END AS months_left
  ) AS d ON TRUE;

COMMENT ON VIEW public.goal_progress IS
  'Metas com o juntado, o que falta, o ritmo mensal necessario e o alvo mensal escolhido pelo usuario, calculados na leitura.';

-- CREATE OR REPLACE VIEW preserva as reloptions da view antiga, entao em teoria
-- o security_invoker atravessa. Reafirmar e uma linha, e o custo de estar
-- errado e o vazamento que a 013 existiu para fechar: sem isto a view roda como
-- o DONO, a RLS das tabelas base nao se aplica e a meta de qualquer usuario
-- volta para qualquer usuario logado.
ALTER VIEW public.goal_progress SET (security_invoker = true);

GRANT SELECT ON public.goal_progress TO authenticated;

-- =====================================================
-- SECAO 3: conferencia
-- =====================================================
-- Aplicar METADE e o pior resultado: a coluna existiria na tabela, o usuario
-- conseguiria salvar o alvo mensal, e a view nao devolveria o campo -- o
-- desconto simplesmente nao aconteceria, sem erro em lugar nenhum.
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.financial_goals'::regclass
      AND attname = 'monthly_contribution' AND attnum > 0 AND NOT attisdropped
  ) THEN
    problemas := problemas || E'\n  - coluna financial_goals.monthly_contribution nao existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.financial_goals'::regclass
      AND conname = 'financial_goals_monthly_contribution_check'
  ) THEN
    problemas := problemas || E'\n  - CHECK de alvo mensal positivo ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.goal_progress'::regclass
      AND attname = 'monthly_contribution' AND attnum > 0 AND NOT attisdropped
  ) THEN
    problemas := problemas || E'\n  - a view goal_progress nao publica monthly_contribution';
  END IF;

  -- As colunas que a tela de metas e a rota ja consomem tem que continuar de
  -- pe: CREATE OR REPLACE VIEW nao deixa remover coluna, mas deixa trocar a
  -- EXPRESSAO de uma delas -- e um corpo copiado errado passaria calado.
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.goal_progress'::regclass
      AND attname = 'monthly_required' AND attnum > 0 AND NOT attisdropped
  ) THEN
    problemas := problemas || E'\n  - a view goal_progress perdeu monthly_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.goal_progress'::regclass
      AND attname = 'saved' AND attnum > 0 AND NOT attisdropped
  ) THEN
    problemas := problemas || E'\n  - a view goal_progress perdeu saved';
  END IF;

  -- O item mais caro da lista: sem security_invoker a view devolve a meta de
  -- TODO mundo para qualquer usuario logado. Ver o cabecalho da 013.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.goal_progress'::regclass
      AND reloptions @> ARRAY['security_invoker=true']
  ) THEN
    problemas := problemas || E'\n  - goal_progress ficou SEM security_invoker (vazamento: a view roda como o dono e a RLS nao se aplica)';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION E'018 aplicou parcialmente:%', problemas;
  END IF;

  RAISE NOTICE '018 conferido: monthly_contribution na tabela e na view, CHECK de positivo, e goal_progress com security_invoker.';
END $$;

-- =====================================================
-- SECAO 4: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('018', '018_goal_monthly_contribution',
        'Alvo mensal da meta (financial_goals.monthly_contribution) para a reserva entrar no "quanto posso gastar" - HMO-155', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
