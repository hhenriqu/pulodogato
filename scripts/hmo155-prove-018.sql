-- =====================================================
-- HMO-155 - PROVA DE QUE A 018 ESTA NO BANCO
-- =====================================================
-- O aceite 3 da HMO-155 pede "conferencia objeto por objeto no catalogo".
-- Este arquivo e essa conferencia. Ele NAO aplica nada: e so-leitura e roda
-- com o papel `paperclip_ro` de producao, que e o unico que temos la.
--
-- POR QUE UM ARQUIVO, E NAO UMA CONSULTA DIGITADA NA HORA
-- ------------------------------------------------------
-- Aplicar METADE da 018 e o pior resultado possivel, e esta escrito na SECAO 3
-- da propria migration: a coluna existiria na tabela, o usuario conseguiria
-- salvar o alvo mensal, e a view NAO devolveria o campo -- o desconto
-- simplesmente nao aconteceria, sem erro em lugar nenhum, nem no banco nem na
-- tela. "A tabela tem a coluna" nao prova a 018. Sao SETE objetos.
--
-- DUAS ARMADILHAS DE INTROSPECCAO, EVITADAS DE PROPOSITO AQUI
-- ----------------------------------------------------------
-- 1. `'public.goal_progress'::regclass` levanta excecao quando o objeto nao
--    existe, e uma excecao no meio do arquivo aborta as conferencias
--    SEGUINTES -- some justamente a informacao de quanto falta. Todo acesso a
--    catalogo aqui passa por `to_regclass()`, que devolve NULL.
-- 2. Conferencia que so lista o que ACHOU responde "nenhum problema" com zero
--    linhas quando nao achou nada. Aqui cada objeto esperado e uma linha fixa
--    de um VALUES; objeto ausente aparece como linha FALTA, nunca como
--    ausencia de linha.
--
-- Uso:
--   psql "$SUPABASE_DB_URL_RO" -f scripts/hmo155-prove-018.sql
--
-- Leitura do resultado: a ultima linha (VEREDITO) e a que importa.
-- 7 de 7 = a 018 esta aplicada. Qualquer outro numero = aplicada pela metade
-- ou nao aplicada, e a coluna `obtido` diz qual objeto faltou.

\pset pager off

WITH esperado(seq, objeto, esperado) AS (
  VALUES
    (1, 'coluna financial_goals.monthly_contribution', 'numeric(15,2)'),
    (2, 'CHECK financial_goals_monthly_contribution_check', 'NULL ou > 0'),
    (3, 'COMMENT na coluna monthly_contribution',        'presente'),
    (4, 'coluna monthly_contribution na view goal_progress', 'presente, e a ULTIMA'),
    (5, 'view goal_progress com security_invoker',       'true'),
    (6, 'GRANT SELECT em goal_progress para authenticated', 'concedido'),
    (7, 'COMMENT na view goal_progress',                 'cita o alvo mensal')
),
obtido(seq, obtido) AS (
  VALUES
    (1, COALESCE(
          (SELECT format_type(a.atttypid, a.atttypmod)
             FROM pg_attribute a
            WHERE a.attrelid = to_regclass('public.financial_goals')
              AND a.attname  = 'monthly_contribution'
              AND NOT a.attisdropped),
          'FALTA')),
    (2, COALESCE(
          (SELECT CASE
                    WHEN pg_get_constraintdef(c.oid) ILIKE '%monthly_contribution IS NULL%'
                     AND pg_get_constraintdef(c.oid) LIKE  '%> (0)%'
                    THEN 'NULL ou > 0'
                    ELSE 'DIFERENTE: ' || pg_get_constraintdef(c.oid)
                  END
             FROM pg_constraint c
            WHERE c.conrelid = to_regclass('public.financial_goals')
              AND c.conname  = 'financial_goals_monthly_contribution_check'),
          'FALTA')),
    (3, COALESCE(
          (SELECT CASE WHEN col_description(a.attrelid, a.attnum) IS NOT NULL
                       THEN 'presente' ELSE 'FALTA' END
             FROM pg_attribute a
            WHERE a.attrelid = to_regclass('public.financial_goals')
              AND a.attname  = 'monthly_contribution'
              AND NOT a.attisdropped),
          'FALTA')),
    -- A posicao importa: CREATE OR REPLACE VIEW so sabe ACRESCENTAR coluna no
    -- fim. Se `monthly_contribution` nao for a ultima, a view que esta no banco
    -- nao e a que este repositorio descreve -- alguem a recriou por outro
    -- caminho, e as colunas seguintes podem estar trocadas de lugar.
    (4, COALESCE(
          (SELECT CASE
                    WHEN a.attnum = (SELECT max(a2.attnum)
                                       FROM pg_attribute a2
                                      WHERE a2.attrelid = to_regclass('public.goal_progress')
                                        AND a2.attnum > 0
                                        AND NOT a2.attisdropped)
                    THEN 'presente, e a ULTIMA'
                    ELSE 'presente, mas FORA DO FIM (attnum=' || a.attnum || ')'
                  END
             FROM pg_attribute a
            WHERE a.attrelid = to_regclass('public.goal_progress')
              AND a.attname  = 'monthly_contribution'
              AND NOT a.attisdropped),
          'FALTA')),
    (5, COALESCE(
          (SELECT CASE
                    WHEN 'security_invoker=true' = ANY(c.reloptions) THEN 'true'
                    WHEN c.reloptions IS NULL THEN 'FALTA (view sem reloptions: roda como o DONO)'
                    ELSE 'FALTA (' || array_to_string(c.reloptions, ',') || ')'
                  END
             FROM pg_class c
            WHERE c.oid = to_regclass('public.goal_progress')),
          'FALTA')),
    (6, CASE
          WHEN to_regclass('public.goal_progress') IS NULL THEN 'FALTA (view ausente)'
          WHEN has_table_privilege('authenticated', 'public.goal_progress', 'SELECT')
            THEN 'concedido'
          ELSE 'FALTA'
        END),
    (7, COALESCE(
          (SELECT CASE WHEN obj_description(to_regclass('public.goal_progress'), 'pg_class')
                            ILIKE '%alvo mensal%'
                       THEN 'cita o alvo mensal'
                       ELSE 'FALTA (comentario antigo, sem o alvo mensal)'
                  END),
          'FALTA'))
)
SELECT e.seq,
       e.objeto,
       e.esperado,
       o.obtido,
       CASE WHEN o.obtido = e.esperado THEN 'OK' ELSE 'FALTA' END AS veredito
  FROM esperado e
  JOIN obtido   o USING (seq)

UNION ALL

SELECT 99,
       'VEREDITO',
       '7 de 7 OK',
       (SELECT count(*) FILTER (WHERE o.obtido = e.esperado)::text || ' de 7 OK'
          FROM esperado e JOIN obtido o USING (seq)),
       (SELECT CASE WHEN count(*) FILTER (WHERE o.obtido = e.esperado) = 7
                    THEN '018 APLICADA'
                    WHEN count(*) FILTER (WHERE o.obtido = e.esperado) = 0
                    THEN '018 NAO APLICADA'
                    ELSE '018 PELA METADE -- ver as linhas FALTA acima'
               END
          FROM esperado e JOIN obtido o USING (seq))
 ORDER BY 1;
