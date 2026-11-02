-- ===========================================================================
-- 079 -- O DEPENDENTE NAO DIVIDE DESPESA, E PODE MORAR NA CASA QUE FECHA
-- ===========================================================================
-- Fecha o RN024.5 (visao da casa, 078). O dependente e o membro sem conta da
-- 077 (`user_id` nulo + `display_name`) -- o filho, quem nao vai instalar o
-- app. Ate aqui ele tinha dois problemas:
--
--   1. ENTRAVA NO RATEIO. O rateio igual (`calculate_equal_split`) conta todo
--      membro ativo: numa casa de tres adultos e um filho, o mercado de 120
--      virava 30 para cada um, inclusive para quem nao paga nada.
--   2. NAO ENTRAVA NA CASA QUE FECHA. A 077 recusa (PDG77) membro sem conta em
--      grupo com dia de fechamento, porque o fechamento gera uma conta a pagar
--      ou a receber por pessoa com conta. E a casa de producao fecha.
--
-- A SOLUCAO: `group_members.participa_da_divisao`. TRUE para todo mundo (o
-- comportamento de hoje); FALSE e o dependente. Quem nao participa:
--
--   * nunca recebe parte de despesa: o trigger da SECAO 3 descarta a parte de
--     fachada (valor 0) que os caminhos de rateio inserem para "todo membro
--     ativo", e RECUSA uma parte com valor (divisao combinada a mao);
--   * nao conta no rateio igual (SECAO 4, `calculate_equal_split` da 077 com o
--     filtro). Na divisao por peso ele ja nao pesava: o CHECK da SECAO 2 prende
--     o `percentage` dele em zero;
--   * pode estar ativo num grupo que fecha (SECAO 5): o fechamento ja le so
--     quem tem conta (`lib/services/fechamento-dos-grupos.ts`,
--     `.filter((m) => m.user_id)`), e quem nao tem parte nenhuma nao tem o que
--     fechar. As duas travas PDG77 da 077 passam a olhar so o membro sem conta
--     que PARTICIPA da divisao.
--
-- So o membro sem conta pode ficar fora da divisao: quem tem conta e adulto da
-- casa, paga a parte dele, e o fechamento gera a conta dele (CHECK da SECAO 2).
--
-- O PASSO HUMANO
-- --------------
-- Colar no SQL Editor do Supabase depois da 077 e da 078. Re-executavel.
-- ===========================================================================

BEGIN;

-- ===========================================================================
-- SECAO 1: PREFLIGHT
-- ===========================================================================
DO $$
DECLARE
  v_faltando text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'group_transactions'
       AND column_name = 'paid_by_member_id'
  ) THEN
    v_faltando := v_faltando || E'\n  - group_transactions.paid_by_member_id (vem da 077)';
  END IF;
  IF to_regprocedure('public.group_members_sem_conta_fora_do_fechamento()') IS NULL THEN
    v_faltando := v_faltando || E'\n  - funcao group_members_sem_conta_fora_do_fechamento (vem da 077)';
  END IF;
  IF to_regprocedure('public.membros_da_casa(uuid)') IS NULL THEN
    v_faltando := v_faltando || E'\n  - funcao membros_da_casa (vem da 078)';
  END IF;
  IF v_faltando <> '' THEN
    RAISE EXCEPTION E'A 079 nao pode ser aplicada neste banco. Faltando:%', v_faltando;
  END IF;
END $$;

-- ===========================================================================
-- SECAO 2: A COLUNA E AS REGRAS DELA
-- ===========================================================================
ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS participa_da_divisao boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.group_members.participa_da_divisao IS
  'FALSE = dependente (079): membro sem conta que mora na casa mas nao recebe parte de despesa, nao conta no rateio igual e pode estar em grupo com dia de fechamento. So o membro sem conta pode ficar fora, e com percentage zero.';

ALTER TABLE public.group_members DROP CONSTRAINT IF EXISTS group_members_fora_da_divisao_sem_conta_check;
ALTER TABLE public.group_members
  ADD CONSTRAINT group_members_fora_da_divisao_sem_conta_check
  CHECK (participa_da_divisao OR user_id IS NULL);

ALTER TABLE public.group_members DROP CONSTRAINT IF EXISTS group_members_fora_da_divisao_sem_peso_check;
ALTER TABLE public.group_members
  ADD CONSTRAINT group_members_fora_da_divisao_sem_peso_check
  CHECK (participa_da_divisao OR COALESCE(percentage, 0) = 0);

-- Mudar depois de criado: so o admin (como o percentual, 040), e nao para
-- tirar da divisao quem ja tem parte em despesa -- as partes dele ficariam
-- orfas de um rateio que nao o conta mais.
CREATE OR REPLACE FUNCTION public.participa_da_divisao_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.participa_da_divisao IS NOT DISTINCT FROM OLD.participa_da_divisao THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.is_group_admin(OLD.group_id) THEN
    RAISE EXCEPTION 'so um admin do grupo muda quem participa da divisao'
      USING ERRCODE = '42501';
  END IF;

  IF NOT NEW.participa_da_divisao AND EXISTS (
       SELECT 1 FROM public.group_expense_splits es
        WHERE es.member_id = OLD.id AND es.amount <> 0
     ) THEN
    RAISE EXCEPTION 'esta pessoa ja tem parte em despesas do grupo; acerte e apague essas partes antes de tira-la da divisao'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_participa_da_divisao_guard ON public.group_members;
CREATE TRIGGER trg_participa_da_divisao_guard
  BEFORE UPDATE OF participa_da_divisao ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.participa_da_divisao_guard();

-- ===========================================================================
-- SECAO 3: QUEM NAO PARTICIPA NAO RECEBE PARTE
-- ===========================================================================
-- Os caminhos que criam partes (auto_create_group_transaction, o
-- `refazer_rateio_do_grupo` da 042, `recalcular_partes_pendentes` e
-- `lancar_despesa_paga_por_membro` da 077) inserem uma linha para cada membro
-- ATIVO. Em vez de repetir o filtro em cada um, o filtro mora na porta da
-- tabela: a parte de valor zero de quem nao participa e descartada (RETURN
-- NULL), e uma parte com valor e recusada -- ela so viria de alguem dividindo
-- a mao, e descartar em silencio deixaria a despesa somando menos que o total.
--
-- O nome comeca com `trg_` e roda DEPOIS do `calculate_equal_split_trigger`
-- (ordem alfabetica dos BEFORE). Com o filtro da SECAO 4 o rateio igual nao da
-- posicao ao dependente, entao a parte dele chega aqui ainda com valor zero.
CREATE OR REPLACE FUNCTION public.dependente_fora_da_divisao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM public.group_members gm
        WHERE gm.id = NEW.member_id AND NOT gm.participa_da_divisao
     ) THEN
    IF COALESCE(NEW.amount, 0) = 0 THEN
      RETURN NULL;
    END IF;
    RAISE EXCEPTION 'dependente nao divide despesa: tire-o da divisao combinada'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.dependente_fora_da_divisao() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_dependente_fora_da_divisao ON public.group_expense_splits;
CREATE TRIGGER trg_dependente_fora_da_divisao
  BEFORE INSERT OR UPDATE OF member_id, amount ON public.group_expense_splits
  FOR EACH ROW EXECUTE FUNCTION public.dependente_fora_da_divisao();

-- ===========================================================================
-- SECAO 4: O RATEIO IGUAL CONTA SO QUEM PARTICIPA
-- ===========================================================================
-- O corpo da 077 inteiro (CREATE OR REPLACE troca tudo). O que muda sao as
-- duas linhas `AND gm.participa_da_divisao`, marcadas com "079".
CREATE OR REPLACE FUNCTION public.calculate_equal_split() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_split_type TEXT;
    v_total_cents BIGINT;
    v_n INTEGER;
    v_rank INTEGER;
    v_base BIGINT;
    v_resto BIGINT;
BEGIN
    SELECT gt.split_type INTO v_split_type
      FROM public.group_transactions gt
     WHERE gt.id = NEW.group_transaction_id;

    IF v_split_type IS NOT NULL AND v_split_type <> 'equal' THEN
        RETURN NEW;
    END IF;

    -- 077: a despesa so do grupo tem o valor na propria linha.
    SELECT ROUND(COALESCE(ABS(ft.amount), gt.amount) * 100)::bigint INTO v_total_cents
      FROM public.group_transactions gt
      LEFT JOIN public.financial_transactions ft ON ft.id = gt.transaction_id
     WHERE gt.id = NEW.group_transaction_id;

    IF v_total_cents IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT count(*) INTO v_n
      FROM public.group_members gm
      JOIN public.group_transactions gt ON gt.group_id = gm.group_id
     WHERE gt.id = NEW.group_transaction_id
       AND gm.status = 'active'
       AND gm.participa_da_divisao;  -- 079

    IF v_n IS NULL OR v_n = 0 THEN
        RETURN NEW;
    END IF;

    SELECT posicao INTO v_rank
      FROM (
        SELECT gm.id, row_number() OVER (ORDER BY gm.id) - 1 AS posicao
          FROM public.group_members gm
          JOIN public.group_transactions gt ON gt.group_id = gm.group_id
         WHERE gt.id = NEW.group_transaction_id
           AND gm.status = 'active'
           AND gm.participa_da_divisao  -- 079
      ) AS r
     WHERE r.id = NEW.member_id;

    IF v_rank IS NULL THEN
        RETURN NEW;
    END IF;

    v_base  := v_total_cents / v_n;
    v_resto := v_total_cents - (v_base * v_n);

    NEW.amount := ((v_base + CASE WHEN v_rank < v_resto THEN 1 ELSE 0 END)::numeric) / 100;
    NEW.percentage := GREATEST(ROUND(100.0 / v_n, 2), 0.01);

    RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.calculate_equal_split() IS
  'Rateio igualitario em centavos inteiros (maior resto), somando exatamente o valor da despesa -- do lancamento ou, na despesa so do grupo (077), da propria linha -- entre os membros ativos que participam da divisao (079: o dependente fica fora). Nao toca em rateio custom/percentage/proporcional.';

-- ===========================================================================
-- SECAO 5: O DEPENDENTE PODE MORAR NA CASA QUE FECHA
-- ===========================================================================
-- As duas travas PDG77 da 077, com o mesmo texto, olhando so o membro sem
-- conta que PARTICIPA da divisao. O trigger de group_members passa a disparar
-- tambem quando `participa_da_divisao` muda: devolver o dependente a divisao
-- numa casa que fecha e o mesmo caso que a 077 recusa.
CREATE OR REPLACE FUNCTION public.group_members_sem_conta_fora_do_fechamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.user_id IS NULL AND NEW.status = 'active'
     AND NEW.participa_da_divisao  -- 079: o dependente pode
     AND EXISTS (
       SELECT 1 FROM public.expense_groups g
        WHERE g.id = NEW.group_id AND g.closing_day IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Este grupo fecha num dia do mes, e o fechamento gera uma conta para cada pessoa com conta no app. Quem nao tem conta ainda nao entra num grupo que fecha: tire o dia de fechamento ou convide a pessoa por email.'
      USING ERRCODE = 'PDG77';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_group_members_sem_conta_fora_do_fechamento ON public.group_members;
CREATE TRIGGER trg_group_members_sem_conta_fora_do_fechamento
  BEFORE INSERT OR UPDATE OF user_id, status, group_id, participa_da_divisao ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.group_members_sem_conta_fora_do_fechamento();

CREATE OR REPLACE FUNCTION public.expense_groups_fechamento_sem_membro_sem_conta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.closing_day IS NOT NULL AND OLD.closing_day IS NULL THEN
    IF EXISTS (
         SELECT 1 FROM public.group_members gm
          WHERE gm.group_id = NEW.id AND gm.user_id IS NULL AND gm.status = 'active'
            AND gm.participa_da_divisao  -- 079: o dependente nao impede
       ) THEN
      RAISE EXCEPTION 'Este grupo tem participante sem conta no app, e o fechamento do mes gera uma conta para cada pessoa com conta. Remova o participante sem conta antes de ligar o dia de fechamento.'
        USING ERRCODE = 'PDG77';
    END IF;
    IF EXISTS (
         SELECT 1 FROM public.group_transactions gt
          WHERE gt.group_id = NEW.id AND gt.transaction_id IS NULL
       ) THEN
      RAISE EXCEPTION 'Este grupo tem despesa paga por outra pessoa (lancada so no grupo), e o fechamento do mes so le despesa lancada numa conta. Acerte e apague essas despesas antes de ligar o dia de fechamento.'
        USING ERRCODE = 'PDG77';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.group_members_sem_conta_fora_do_fechamento() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expense_groups_fechamento_sem_membro_sem_conta() FROM PUBLIC;

-- ===========================================================================
-- SECAO 6: QUEM JA E DEPENDENTE NA CASA SAI DA DIVISAO
-- ===========================================================================
-- Na casa (group_kind 'casa', 076), todo membro sem conta e dependente: e
-- assim que a 078 ja mostra (`membros_da_casa.dependente = user_id IS NULL`),
-- e e o que a tela da casa cria. Os que ja existem saem da divisao aqui --
-- menos quem ja tem parte com valor, que o admin acerta antes (o trigger da
-- SECAO 2 recusaria). Em evento e viagem o membro sem conta continua
-- dividindo, como na 077. Re-executar nao muda nada.
UPDATE public.group_members gm
   SET participa_da_divisao = false
  FROM public.expense_groups g
 WHERE g.id = gm.group_id
   AND g.group_kind = 'casa'
   AND gm.user_id IS NULL
   AND gm.participa_da_divisao
   AND COALESCE(gm.percentage, 0) = 0
   AND NOT EXISTS (
         SELECT 1 FROM public.group_expense_splits es
          WHERE es.member_id = gm.id AND es.amount <> 0
       );

-- ===========================================================================
-- SECAO 7: REGISTRO
-- ===========================================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('079', '079_dependente_fora_da_divisao',
        'group_members.participa_da_divisao: o dependente nao recebe parte, nao conta no rateio igual e pode estar na casa com dia de fechamento', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
