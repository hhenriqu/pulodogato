-- =====================================================
-- PULODOGATO - DERIVA DE SCHEMA (FIXTURE)
-- =====================================================
-- Gerado em: 2026-09-21
--
-- O QUE ESTE ARQUIVO PROVA
-- ------------------------
-- Aplicar o 002 em producao ja parou duas vezes, sempre pelo mesmo motivo de
-- fundo: producao tem objeto que nunca passou por este repositorio, e o
-- Postgres reporta uma deriva por vez. Como so o dono do projeto tem credencial
-- no banco, cada parada custa um dia de ida e volta.
--
-- A SECAO 0.0 do 002 e a Q6 do 000_preflight_inventory.sql existem para trocar
-- essa fila por uma resposta so: conferem os pre-requisitos de schema que o
-- resto do 002 assume e relatam tudo que falta de uma vez.
--
-- Este arquivo nao faz assercao - ele planta o estado. Sao tres derivas de
-- tipos diferentes ao mesmo tempo, e as duas verificacoes tem que apontar as
-- tres. As assercoes moram no passo "Deriva de schema" do db-verify, porque
-- dependem do codigo de saida do psql (o 002 tem que FALHAR) e da saida do
-- 000 - checar isso de dentro do SQL exigiria uma terceira copia da mesma
-- regra, que e justamente o que nao queremos manter.
--
-- COMO RODAR A MAO (ordem importa - espera 001 aplicado e 002 NAO):
--   psql -f database/tests/00_supabase_shim.sql
--   psql -f database/migrations/001_baseline.sql
--   psql -f database/tests/schema_prereq_test.sql
--
--   psql -f database/migrations/000_preflight_inventory.sql   # Q6: 3 linhas
--   psql -f database/migrations/002_rls_lockdown.sql          # tem que abortar
-- =====================================================

\set ON_ERROR_STOP on

-- (a) Coluna que so o corpo de uma funcao usa. E o caso mais traicoeiro: corpo
--     de funcao em SQL/plpgsql nao registra dependencia de coluna, entao sem a
--     SECAO 0.0 o 002 aplicaria limpo e `is_group_member` - que decide quem ve
--     as transacoes de cada grupo - quebraria depois, ja em producao.
ALTER TABLE public.group_members DROP COLUMN status;

-- (b) Tabela inteira ausente: a policy da SECAO 4 pararia com 42P01.
DROP TABLE public.user_usage_limits CASCADE;

-- (c) O indice unico de que o ON CONFLICT de join_group_by_code depende. O
--     plpgsql nao valida o corpo na criacao: sem esta checagem a falha (42P10)
--     so apareceria quando alguem entrasse num grupo pelo codigo.
--     O nome real em producao e `unique_user_per_group`. O baseline antigo,
--     reconstruido pela API, tinha inventado o nome que o Postgres geraria
--     por padrao (`group_members_group_id_user_id_key`) -- a API nao expoe
--     nome de constraint.
ALTER TABLE public.group_members DROP CONSTRAINT unique_user_per_group;

DO $$
BEGIN
  RAISE NOTICE 'deriva plantada: coluna group_members.status, tabela user_usage_limits, unique group_members(group_id,user_id)';
END $$;
