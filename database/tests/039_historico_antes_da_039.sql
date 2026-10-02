-- =====================================================
-- Historico plantado ANTES da 039 (HMO-197)
-- =====================================================
-- Este arquivo nao testa nada. Ele existe para que o backfill da SECAO 3 da 039
-- tenha em que morder.
--
-- POR QUE ELE E NECESSARIO
-- ------------------------
-- Mesmo motivo do 027_historico_antes_da_027.sql: o db-verify constroi o banco
-- do ZERO, entao quando a 039 roda `group_invitations` esta vazia, o backfill
-- toca ZERO linhas, e nenhuma assercao sobre o estado final distingue um
-- backfill correto de um backfill AUSENTE.
--
-- Medido: sem este arquivo, o mutante "a SECAO 3 nao chama
-- `reclamar_convites_orfaos()`" sobrevive ao teste inteiro. E o mutante que mais
-- importa em producao -- e exatamente ele que deixaria os convites orfaos ja
-- gravados (5 INSERTs medidos em 2026-09-30) invisiveis para sempre, que e o
-- relato da HMO-197. O resto do arquivo de teste exercita o trigger, que so vale
-- para conta criada DEPOIS da migration.
--
-- O ESTADO PLANTADO
-- -----------------
-- O que a rota gravava antes da HMO-196: convite de email, pendente, no prazo, e
-- `invited_user_id` NULO -- com a conta do convidado JA EXISTINDO e confirmada.
-- Essa combinacao e inalcancavel depois da 039 (a rota so grava NULO quando nao
-- ha conta confirmada, e o trigger reclama no cadastro), e e por isso que ela
-- tem que ser plantada a mao aqui.
--
-- A linha de controle NEGATIVO vem junto: um segundo convite orfao cujo email
-- nao tem conta nenhuma. Ele tem que CONTINUAR orfao depois da 039. Sem ele, um
-- backfill largo demais (que preenchesse com qualquer coisa) passaria.
--
-- ELE COMITA, DE PROPOSITO
-- ------------------------
-- A 039 roda no passo seguinte, noutra sessao, e nao veria nada dentro de uma
-- transacao aberta.
--
-- Os ids e emails sao proprios deste arquivo e nao colidem com os do
-- hmo197_convite_sem_conta_test.sql (que usa o sufixo -0197- e @test.local).
--
-- Rodar ENTRE a 038 e a 039:
--   psql "$DB_URL" -f database/tests/039_historico_antes_da_039.sql
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

-- Dona do grupo e a convidada que JA tinha conta quando o convite foi gravado.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('d0d0d0d0-9197-0000-0000-000000000001', 'dona.antes@hist197.local',     NOW()),
  ('a0a0a0a0-9197-0000-0000-000000000002', 'convidada.antes@hist197.local', NOW());

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('d0d0d0d0-9197-0000-0000-000000000001', 'Dona Antes',      FALSE),
  ('a0a0a0a0-9197-0000-0000-000000000002', 'Convidada Antes', FALSE);

-- O trigger add_group_creator_trigger poe a dona como admin ativa sozinho.
INSERT INTO public.expense_groups
  (id, name, description, group_code, group_type, created_by)
VALUES ('60000000-9197-0000-0000-0000000000a7', 'Grupo de antes da 039',
        'plantado para o backfill', 'H197F9', 'private',
        'd0d0d0d0-9197-0000-0000-000000000001');

-- (1) O ORFAO QUE O BACKFILL TEM QUE CONSERTAR.
--     Caixa trocada no email de proposito: e o admin digitando a mao, e e o que
--     exige o LOWER() dos dois lados.
INSERT INTO public.group_invitations
  (id, group_id, invited_by, invite_method, invite_target, invited_user_id,
   status, message, expires_at)
VALUES ('91111111-9197-0000-0000-000000000001',
        '60000000-9197-0000-0000-0000000000a7',
        'd0d0d0d0-9197-0000-0000-000000000001',
        'email', 'Convidada.Antes@HIST197.local', NULL,
        'pending', 'convite de antes da 039', NOW() + INTERVAL '14 days');

-- (2) CONTROLE NEGATIVO: email sem conta nenhuma. Tem que continuar orfao.
INSERT INTO public.group_invitations
  (id, group_id, invited_by, invite_method, invite_target, invited_user_id,
   status, message, expires_at)
VALUES ('92222222-9197-0000-0000-000000000002',
        '60000000-9197-0000-0000-0000000000a7',
        'd0d0d0d0-9197-0000-0000-000000000001',
        'email', 'ninguem.tem.esse@hist197.local', NULL,
        'pending', 'nao existe conta para este', NOW() + INTERVAL '14 days');

COMMIT;
