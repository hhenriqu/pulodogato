-- =====================================================
-- `anon` recebe SELECT em budget_consumption ANTES da 063 (HMO-453)
-- =====================================================
-- Este arquivo nao testa nada. Ele existe para que o `REVOKE ALL ... FROM anon`
-- da 063 tenha em que morder.
--
-- POR QUE ELE E NECESSARIO
-- ------------------------
-- MEDIDO: com a cadeia 001 -> 062 montada do zero, `anon` nao tem privilegio
-- nenhum em `public.budget_consumption` (a 049 revogou, e `CREATE OR REPLACE
-- VIEW` PRESERVA privilegios). Entao a assercao "anon nao tem privilegio em
-- budget_consumption" do `063_*_test.sql` fica verde **com o REVOKE da 063
-- apagado** -- o mutante M8 sobreviveu exatamente assim, e um REVOKE que nunca
-- revoga nada e indistinguivel de um comentario.
--
-- Isso nao e um detalhe de medicao: o REVOKE da 063 existe porque um
-- `CREATE OR REPLACE` que mexesse no ACL da view nao daria sintoma algum, e
-- `budget_consumption` e, por construcao, a lista de quanto cada pessoa gasta
-- por categoria. A linha precisa ser load-bearing, e por isso aqui se planta o
-- estado que a torna load-bearing: o privilegio concedido.
--
-- Mesma familia de `060_lancamentos_antes_da_060.sql`,
-- `058_contas_antes_da_058.sql` e `056_contas_antes_da_056.sql` -- plantar o
-- estado que a migration seguinte tem de mudar, porque num banco do zero esse
-- estado nao existe e `zero de zero` passa em qualquer assercao
-- (`prod-vazia-invalida-prova-por-efeito-colateral`).
--
-- ELE COMITA, DE PROPOSITO
-- ------------------------
-- A 063 roda no passo seguinte, noutra sessao: sem COMMIT ela nao veria nada.
--
-- E O ESTADO QUE ELE DEIXA E UM FURO DE VERDADE, por dois passos do job. Isso
-- e deliberado e tem rede dos dois lados:
--
--   * se a 063 revogar (o caso normal), o furo fecha no passo seguinte;
--   * se a 063 NAO revogar, a secao 6 do `063_*_test.sql` fica vermelha E o
--     step "anon so pode ler as tabelas de referencia", que roda mais abaixo no
--     mesmo job, tambem fica. Dois sinais independentes, e nenhum deles e
--     silencioso.
--
-- `DO` em volta do GRANT porque o papel `anon` so existe com o shim do
-- Supabase (`database/tests/00_supabase_shim.sql`), e este arquivo tem de ser
-- rodavel num Postgres cru sem explodir no primeiro comando.
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'GRANT SELECT ON public.budget_consumption TO anon';
    RAISE NOTICE 'anon recebeu SELECT em budget_consumption -- a 063 tem de revogar';
  ELSE
    RAISE NOTICE 'sem o papel anon neste banco: nada a conceder';
  END IF;
END $$;

COMMIT;
