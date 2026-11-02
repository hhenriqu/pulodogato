-- =====================================================
-- 076 -- o grupo diz se e a casa ou um evento
-- =====================================================
-- Roda no db-verify depois de 076_grupos_antes_da_076.sql, da 076 e da segunda
-- aplicacao dela.
--
-- O QUE CADA SECAO RESPONDE
--   1. Os grupos que ja existiam foram classificados pelo dia de fechamento:
--      com closing_day -> casa, sem -> evento. O arquivado tambem.
--   2. Grupo novo sem tipo nasce evento; o CHECK recusa um terceiro valor; e o
--      tipo e independente da regra de entrada (group_type).
--   3. A escolha de quem editou o grupo sobrevive a colar a 076 de novo. E o
--      que justifica o UPDATE morar dentro do bloco que cria a coluna: um
--      UPDATE solto reclassificaria a casa que a pessoa trocou para evento.
--      Controle negativo no fim: o MESMO UPDATE solto desfaz a escolha, entao a
--      secao mede alguma coisa.
-- =====================================================

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect_text(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- --- 1. a classificacao dos grupos que ja existiam --------------------------

SELECT pg_temp.expect_text('grupo com dia de fechamento virou casa',
  (SELECT group_kind FROM public.expense_groups
    WHERE id = 'bbbb0076-0000-0000-0000-000000000001'), 'casa');

SELECT pg_temp.expect_text('grupo sem dia de fechamento ficou evento',
  (SELECT group_kind FROM public.expense_groups
    WHERE id = 'bbbb0076-0000-0000-0000-000000000002'), 'evento');

SELECT pg_temp.expect_text('grupo arquivado com dia de fechamento virou casa',
  (SELECT group_kind FROM public.expense_groups
    WHERE id = 'bbbb0076-0000-0000-0000-000000000003'), 'casa');

-- Nenhum grupo sem fechamento virou casa (classificacao larga demais).
SELECT pg_temp.expect_text('nenhuma casa sem dia de fechamento, logo depois da 076',
  (SELECT count(*)::text FROM public.expense_groups
    WHERE group_kind = 'casa' AND closing_day IS NULL), '0');

-- --- 2. o grupo novo, o CHECK e a independencia do group_type ---------------

BEGIN;

INSERT INTO public.expense_groups (id, name, group_code, group_type, created_by)
VALUES ('bbbb0076-0000-0000-0000-000000000010', 'Churrasco', 'G76CH0', 'public',
        'aaaa0076-0000-0000-0000-00000000000a');

SELECT pg_temp.expect_text('grupo novo sem tipo nasce evento',
  (SELECT group_kind FROM public.expense_groups
    WHERE id = 'bbbb0076-0000-0000-0000-000000000010'), 'evento');

-- Casa publica e evento privado: as duas colunas nao se prendem.
UPDATE public.expense_groups SET group_kind = 'casa'
 WHERE id = 'bbbb0076-0000-0000-0000-000000000010';
SELECT pg_temp.expect_text('casa publica continua publica',
  (SELECT group_kind || '/' || group_type FROM public.expense_groups
    WHERE id = 'bbbb0076-0000-0000-0000-000000000010'), 'casa/public');

DO $$
BEGIN
  BEGIN
    UPDATE public.expense_groups SET group_kind = 'familia'
     WHERE id = 'bbbb0076-0000-0000-0000-000000000010';
    RAISE EXCEPTION 'FALHA: o CHECK aceitou group_kind = familia';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: o CHECK recusa um tipo fora de casa/evento';
  END;
  BEGIN
    UPDATE public.expense_groups SET group_kind = NULL
     WHERE id = 'bbbb0076-0000-0000-0000-000000000010';
    RAISE EXCEPTION 'FALHA: group_kind aceitou NULL';
  EXCEPTION WHEN not_null_violation THEN
    RAISE NOTICE 'ok: group_kind nao aceita NULL';
  END;
END $$;

ROLLBACK;

-- --- 3. a escolha da pessoa sobrevive a colar a 076 de novo -----------------

-- A dona decide que a "Casa" agora e so um evento (sem tirar o fechamento).
UPDATE public.expense_groups SET group_kind = 'evento'
 WHERE id = 'bbbb0076-0000-0000-0000-000000000001';

\ir ../migrations/076_tipo_do_grupo.sql

SELECT pg_temp.expect_text('a casa trocada para evento continua evento depois de recolar a 076',
  (SELECT group_kind FROM public.expense_groups
    WHERE id = 'bbbb0076-0000-0000-0000-000000000001'), 'evento');

-- Controle negativo: o UPDATE que a 076 faz, se rodasse solto em toda
-- aplicacao, desfaria a escolha. Se esta assercao falhar, a linha acima nao
-- estava medindo nada.
BEGIN;
UPDATE public.expense_groups SET group_kind = 'casa' WHERE closing_day IS NOT NULL;
SELECT pg_temp.expect_text('controle negativo: o UPDATE solto desfaria a escolha',
  (SELECT group_kind FROM public.expense_groups
    WHERE id = 'bbbb0076-0000-0000-0000-000000000001'), 'casa');
ROLLBACK;

-- Devolve a fixture ao estado classificado, para as suites seguintes.
UPDATE public.expense_groups SET group_kind = 'casa'
 WHERE id = 'bbbb0076-0000-0000-0000-000000000001';
