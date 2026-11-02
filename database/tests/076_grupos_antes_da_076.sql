-- =====================================================
-- Grupos plantados ANTES da 076 (tipo do grupo: casa ou evento)
-- =====================================================
-- Este arquivo nao testa nada. Ele existe para que a classificacao da 076
-- tenha em que morder.
--
-- Mesmo motivo do 039_historico_antes_da_039.sql: o db-verify constroi o banco
-- do ZERO, e os grupos que as suites anteriores deixam nao tem dia de
-- fechamento. Sem este arquivo, "a 076 nao classifica ninguem como casa"
-- passaria verde: todo grupo viraria evento, e e evento que se espera de quase
-- todos.
--
-- O ESTADO PLANTADO
-- -----------------
--   G1 "Casa"             ativo,     closing_day 5    -> tem que virar casa
--   G2 "Viagem a Bahia"   ativo,     sem fechamento   -> tem que ficar evento
--   G3 "Casa antiga"      arquivado, closing_day 10   -> casa (o arquivo guarda
--                                                       o que o grupo era)
--
-- ELE COMITA, DE PROPOSITO: a 076 roda no passo seguinte, noutra sessao.
--
-- Rodar ENTRE a 075 e a 076:
--   psql "$DB_URL" -f database/tests/076_grupos_antes_da_076.sql
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('aaaa0076-0000-0000-0000-00000000000a', 'dona@g076.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('aaaa0076-0000-0000-0000-00000000000a', 'Dona 076', FALSE);

-- O trigger add_group_creator_trigger poe a dona como admin ativa sozinho.
INSERT INTO public.expense_groups
  (id, name, group_code, group_type, created_by, closing_day, is_active)
VALUES
  ('bbbb0076-0000-0000-0000-000000000001', 'Casa', 'G76CS1', 'private',
   'aaaa0076-0000-0000-0000-00000000000a', 5, TRUE),
  ('bbbb0076-0000-0000-0000-000000000002', 'Viagem a Bahia', 'G76VG2', 'private',
   'aaaa0076-0000-0000-0000-00000000000a', NULL, TRUE),
  ('bbbb0076-0000-0000-0000-000000000003', 'Casa antiga', 'G76CA3', 'private',
   'aaaa0076-0000-0000-0000-00000000000a', 10, FALSE);

COMMIT;
