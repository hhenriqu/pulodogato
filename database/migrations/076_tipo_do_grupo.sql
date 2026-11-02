-- 076_tipo_do_grupo.sql
--
-- O grupo passa a dizer o que ele e: a CASA (a familia, permanente, que fecha
-- todo mes) ou um EVENTO (a viagem, o churrasco, que acerta uma vez). Item 3 do
-- plano em docs/MAPA-DO-PROJETO.md ("Dar nome a familia"), e o terreno para a
-- visao da casa e para o grupo de evento sem login.
--
-- POR QUE UMA COLUNA NOVA E NAO `group_type`
-- -------------------------------------------
-- O mapa sugere o tipo "no lugar de public/private", mas `group_type` nao e um
-- rotulo: e a regra de ENTRADA. `join_group_by_code` (002, refeita pela 029)
-- deixa entrar direto quem usa o codigo de um grupo `public` e deixa `pending`
-- quem entra num `private`. Trocar os valores dessa coluna mudaria quem precisa
-- de aprovacao em todo grupo que ja existe. As duas perguntas sao
-- independentes -- uma casa pode ser publica e um churrasco privado --, entao
-- cada uma tem a sua coluna: `group_type` (quem entra) e `group_kind` (o que o
-- grupo e).
--
-- OS GRUPOS QUE JA EXISTEM
-- ------------------------
-- Ate aqui a diferenca era implicita: o grupo que se comporta como casa e o que
-- tem dia de fechamento (RN018, 067) -- o grupo "Casa" de producao, com tres
-- pessoas, e assim. Entao, NA PRIMEIRA aplicacao:
--   * `closing_day` preenchido  -> 'casa'
--   * `closing_day` nulo        -> 'evento' (o DEFAULT)
-- Arquivado ou nao, a regra e a mesma: o arquivo guarda o que o grupo era.
--
-- A classificacao roda so quando a coluna nasce. Colar a 076 de novo depois de
-- alguem ter mudado um grupo de casa para evento na tela NAO pode desfazer a
-- escolha da pessoa -- por isso o UPDATE mora no mesmo bloco que cria a coluna.
--
-- O tipo nao trava nada sozinho: um evento pode ganhar dia de fechamento e uma
-- casa pode ficar sem. O que muda com o tipo (visao da casa, acerto unico do
-- evento) vem nas proximas entregas, lendo esta coluna.
--
-- Idempotente: pode ser colada duas vezes. Cola como lote unico no SQL Editor
-- (nenhum meta-comando de psql aqui).

BEGIN;

DO $$
DECLARE
  problemas text := '';
BEGIN
  IF to_regclass('public.expense_groups') IS NULL THEN
    problemas := problemas || E'\n  - public.expense_groups nao existe (001); e a tabela que ganha o tipo';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'expense_groups'
       AND column_name = 'closing_day'
  ) THEN
    problemas := problemas || E'\n  - expense_groups.closing_day nao existe (067); e por ela que os grupos existentes sao classificados';
  END IF;
  IF problemas <> '' THEN
    RAISE EXCEPTION 'A migration 076 nao pode ser aplicada neste banco:%', problemas;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'expense_groups'
       AND column_name = 'group_kind'
  ) THEN
    ALTER TABLE public.expense_groups
      ADD COLUMN group_kind text NOT NULL DEFAULT 'evento';

    -- A classificacao dos grupos que ja existem. So aqui dentro: na segunda
    -- aplicacao a coluna ja existe e a escolha de quem editou o grupo fica.
    UPDATE public.expense_groups
       SET group_kind = 'casa'
     WHERE closing_day IS NOT NULL;

    RAISE NOTICE '076: expense_groups.group_kind criada; % grupo(s) com dia de fechamento viraram casa',
      (SELECT count(*) FROM public.expense_groups WHERE group_kind = 'casa');
  END IF;
END $$;

ALTER TABLE public.expense_groups DROP CONSTRAINT IF EXISTS expense_groups_group_kind_check;
ALTER TABLE public.expense_groups
  ADD CONSTRAINT expense_groups_group_kind_check
  CHECK (group_kind IN ('casa', 'evento'));

COMMENT ON COLUMN public.expense_groups.group_kind IS
  'O que o grupo e (076): casa = a familia, permanente, fecha todo mes; evento = viagem, churrasco, acerta uma vez. Independente de group_type, que e a regra de ENTRADA (public entra direto, private fica pending). Na 076 os grupos com closing_day viraram casa e os demais evento.';

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('076', '076_tipo_do_grupo',
        'expense_groups.group_kind (casa/evento); grupos com dia de fechamento viram casa', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
