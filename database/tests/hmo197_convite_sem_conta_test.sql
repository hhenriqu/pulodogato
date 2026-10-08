-- =====================================================
-- HMO-197: convite para um email que ainda nao tem conta
-- =====================================================
-- Terceira falha da HMO-190. O convite gravado com `invited_user_id` NULO e
-- invisivel para todo mundo e para sempre: `list_my_group_invitations()` (030),
-- `respond_to_group_invitation()` (030) e `has_pending_invitation()` (002) todas
-- exigem `invited_user_id = auth.uid()`, e nada preenchia esse campo no
-- cadastro. A 039 poe um trigger em `profiles` que reclama o convite quando a
-- conta daquele email nasce.
--
-- O QUE CADA SECAO PROVA, E POR QUE ELA NAO E SUPERFLUA
-- -----------------------------------------------------
-- (1) CONTROLE NEGATIVO: antes do cadastro o convite e invisivel. Sem esta
--     secao, a (2) poderia passar com um convite que ja estava visivel e o teste
--     nao provaria entrega nenhuma.
-- (2) o trigger reclama no cadastro, e as TRES leituras passam a enxergar.
-- (3) o convite entra pela porta: `has_pending_invitation` libera o INSERT em
--     `group_members` e `respond_to_group_invitation` conclui. Sem isto, "o
--     convite aparece" poderia conviver com "aceitar da erro" -- que foi
--     exatamente o estado da HMO-196.
-- (4) o trigger NAO casa por `profiles.email`. Esta e a secao de SEGURANCA: a
--     policy `profiles_update_own` da 002 deixa qualquer um escrever qualquer
--     string no proprio `profiles.email` (policy de RLS trava linha, nao
--     coluna), entao casar por ali seria roubo de convite. A secao forja
--     exatamente esse ataque e exige que ele falhe.
-- (5) conta NAO confirmada nao reclama nada -- mesma condicao do
--     `get_user_by_email()`, que e o que faz os dois lados serem complementares.
-- (6) o que o trigger tem que deixar quieto: convite de outro email, convite ja
--     com dono, expirado, nao-pendente e de outro `invite_method`.
-- (7) backfill (SECAO 3 da 039): convite orfao de conta que JA existia.
--
-- Rodar num banco limpo, depois da cadeia ate 039:
--   psql "$DB_URL" -f database/tests/hmo197_convite_sem_conta_test.sql
--
-- Qualquer FALHA lanca excecao e aborta.
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect(label TEXT, got BIGINT, want BIGINT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_text(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %',
      label, coalesce(want, '<nulo>'), coalesce(got, '<nulo>');
  END IF;
  RAISE NOTICE 'ok: % (%)', label, coalesce(got, '<nulo>');
END $$;

-- =====================================================
-- CENARIO
-- =====================================================
-- DONA     : admin que convida, conta confirmada, ja tem perfil.
-- NOVATA   : o caso da issue. A conta nasce DEPOIS do convite.
-- LADRA    : tenta levar o convite da NOVATA escrevendo o email dela no proprio
--            perfil (secao 4).
-- SEMCONF  : conta criada mas email nao confirmado (secao 5).
-- ANTIGA   : conta confirmada que JA existia quando o convite orfao foi
--            gravado -- o caso do backfill (secao 7).
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('d0d0d0d0-0197-0000-0000-000000000001', 'dona@test.local',    NOW()),
  ('a0a0a0a0-0197-0000-0000-000000000002', 'novata@test.local',  NOW()),
  ('c0c0c0c0-0197-0000-0000-000000000003', 'ladra@test.local',   NOW()),
  ('50505050-0197-0000-0000-000000000004', 'semconf@test.local', NULL),
  ('a7a7a7a7-0197-0000-0000-000000000005', 'antiga@test.local',  NOW());

-- Só a DONA e a ANTIGA tem perfil agora. A NOVATA e a LADRA se "cadastram"
-- (INSERT em profiles) no meio do teste -- e esse INSERT e o gatilho.
INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('d0d0d0d0-0197-0000-0000-000000000001', 'Dona',   FALSE),
  ('a7a7a7a7-0197-0000-0000-000000000005', 'Antiga', FALSE);

INSERT INTO public.expense_groups (id, name, description, group_code, group_type, created_by)
VALUES ('60000000-0197-0000-0000-0000000000a7', 'Casa de codigo', 'A casa',
        'A197F9', 'private', 'd0d0d0d0-0197-0000-0000-000000000001');

-- O convite como a rota passa a grava-lo quando `get_user_by_email` nao acha
-- ninguem: `invited_user_id` NULO. Escrito pela RLS de verdade, com a DONA
-- logada -- `group_invitations_insert` exige `invited_by = auth.uid()` e
-- `is_group_admin(group_id)`, e NAO exige `invited_user_id` preenchido.
--
-- A CAIXA do email e trocada de proposito ('Novata@TEST.local' x
-- 'novata@test.local'): e o caso real do admin digitando o endereco a mao, e e o
-- que exige o LOWER() dos dois lados da comparacao.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd0d0d0d0-0197-0000-0000-000000000001';

INSERT INTO public.group_invitations
  (id, group_id, invited_by, invite_method, invite_target, invited_user_id,
   message, expires_at)
VALUES ('11111111-0197-0000-0000-000000000001',
        '60000000-0197-0000-0000-0000000000a7',
        'd0d0d0d0-0197-0000-0000-000000000001',
        'email', '  Novata@TEST.local ',
        NULL,
        'vem pro grupo', NOW() + INTERVAL '14 days');

RESET ROLE;

SELECT pg_temp.expect(
  'convite gravado sem dono (a RLS de INSERT permite invited_user_id nulo)',
  (SELECT count(*) FROM public.group_invitations
    WHERE id = '11111111-0197-0000-0000-000000000001'
      AND invited_user_id IS NULL),
  1);

-- =====================================================
-- (1) CONTROLE NEGATIVO: sem conta, o convite e invisivel
-- =====================================================
-- A NOVATA ainda nao tem perfil, mas ja pode ter sessao (o perfil nasce em
-- /auth/callback). Com a sessao dela, as tres leituras do produto devolvem zero.
-- E este o estado que a issue descreve como "orfao para sempre".
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0a0a0a0-0197-0000-0000-000000000002';

SELECT pg_temp.expect(
  'CONTROLE: antes do cadastro, list_my_group_invitations() nao ve o convite',
  (SELECT count(*) FROM public.list_my_group_invitations()), 0);

SELECT pg_temp.expect(
  'CONTROLE: antes do cadastro, o SELECT direto nao ve o convite (RLS)',
  (SELECT count(*) FROM public.group_invitations), 0);

SELECT pg_temp.expect_text(
  'CONTROLE: antes do cadastro, has_pending_invitation() e falso',
  (SELECT public.has_pending_invitation('60000000-0197-0000-0000-0000000000a7')::TEXT),
  'false');

RESET ROLE;

-- =====================================================
-- (2) O CADASTRO ENTREGA O CONVITE
-- =====================================================
-- O INSERT em profiles e exatamente o que `garantirPerfil()` faz, e com a RLS da
-- NOVATA: `profiles_insert_own` exige `id = auth.uid()`.
--
-- `email` do perfil fica NULO de proposito. A entrega NAO pode depender dele --
-- e o campo forjavel, e a secao 4 cobre o ataque. Se alguem "simplificar" o
-- trigger para ler NEW.email, esta secao quebra na hora.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0a0a0a0-0197-0000-0000-000000000002';

INSERT INTO public.profiles (id, full_name, email, is_public)
VALUES ('a0a0a0a0-0197-0000-0000-000000000002', 'Novata', NULL, FALSE);

SELECT pg_temp.expect(
  'o trigger preencheu invited_user_id com a conta nova',
  (SELECT count(*) FROM public.group_invitations
    WHERE id = '11111111-0197-0000-0000-000000000001'
      AND invited_user_id = 'a0a0a0a0-0197-0000-0000-000000000002'),
  1);

SELECT pg_temp.expect(
  'agora list_my_group_invitations() entrega 1 convite',
  (SELECT count(*) FROM public.list_my_group_invitations()), 1);

SELECT pg_temp.expect_text(
  'e o convite vem com o nome do grupo (o sino tem o que mostrar)',
  (SELECT group_name FROM public.list_my_group_invitations()),
  'Casa de codigo');

SELECT pg_temp.expect_text(
  'has_pending_invitation() agora libera a entrada',
  (SELECT public.has_pending_invitation('60000000-0197-0000-0000-0000000000a7')::TEXT),
  'true');

RESET ROLE;

-- =====================================================
-- (3) ACEITAR FUNCIONA DE PONTA A PONTA
-- =====================================================
-- "Aparece no sino" e "da para aceitar" sao coisas diferentes: na HMO-196 o
-- convite era legivel e o aceite respondia 500. Aqui o aceite tem que gravar
-- membro ATIVO e fechar o convite.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0a0a0a0-0197-0000-0000-000000000002';

SELECT pg_temp.expect_text(
  'respond_to_group_invitation() aceita e devolve o membro ativo',
  (SELECT member_status FROM public.respond_to_group_invitation(
     '11111111-0197-0000-0000-000000000001', TRUE)),
  'active');

RESET ROLE;

SELECT pg_temp.expect(
  'a NOVATA virou membro ativo do grupo',
  (SELECT count(*) FROM public.group_members
    WHERE group_id = '60000000-0197-0000-0000-0000000000a7'
      AND user_id  = 'a0a0a0a0-0197-0000-0000-000000000002'
      AND status   = 'active'),
  1);

SELECT pg_temp.expect_text(
  'e o convite ficou accepted (o sino para de oferecer)',
  (SELECT status FROM public.group_invitations
    WHERE id = '11111111-0197-0000-0000-000000000001'),
  'accepted');

-- =====================================================
-- (4) SEGURANCA: nao se rouba convite por profiles.email
-- =====================================================
-- A LADRA se cadastra com email proprio e escreve o email da VITIMA no proprio
-- perfil -- escrita que a RLS da 002 PERMITE (profiles_update_own so olha a
-- linha; nao existe OLD numa policy, entao a coluna fica livre).
--
-- O alvo e um convite novo, ainda sem dono, endereçado a um terceiro email que
-- nao tem conta nenhuma.
INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES ('b0b0b0b0-0197-0000-0000-000000000006', 'vitima@test.local', NOW());

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd0d0d0d0-0197-0000-0000-000000000001';

INSERT INTO public.group_invitations
  (id, group_id, invited_by, invite_method, invite_target, invited_user_id,
   message, expires_at)
VALUES ('22222222-0197-0000-0000-000000000002',
        '60000000-0197-0000-0000-0000000000a7',
        'd0d0d0d0-0197-0000-0000-000000000001',
        'email', 'vitima@test.local', NULL, NULL,
        NOW() + INTERVAL '14 days');

RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'c0c0c0c0-0197-0000-0000-000000000003';

-- O cadastro da LADRA, mentindo o email no perfil. Se o trigger lesse
-- `NEW.email`, o convite da VITIMA sairia daqui no nome dela.
INSERT INTO public.profiles (id, full_name, email, is_public)
VALUES ('c0c0c0c0-0197-0000-0000-000000000003', 'Ladra',
        'vitima@test.local', FALSE);

SELECT pg_temp.expect(
  'SEGURANCA: cadastro com profiles.email forjado NAO leva o convite',
  (SELECT count(*) FROM public.list_my_group_invitations()), 0);

-- Segundo vetor, agora por UPDATE: a LADRA ja tem perfil e reescreve o email.
-- O trigger e AFTER INSERT, entao nem dispara -- esta assercao e o que impede
-- alguem de "melhorar" a 039 acrescentando OR UPDATE sem notar o que abre.
UPDATE public.profiles SET email = 'vitima@test.local'
 WHERE id = 'c0c0c0c0-0197-0000-0000-000000000003';

SELECT pg_temp.expect(
  'SEGURANCA: UPDATE de profiles.email tambem nao leva o convite',
  (SELECT count(*) FROM public.list_my_group_invitations()), 0);

RESET ROLE;

SELECT pg_temp.expect(
  'o convite da vitima continua sem dono, esperando a conta dela',
  (SELECT count(*) FROM public.group_invitations
    WHERE id = '22222222-0197-0000-0000-000000000002'
      AND invited_user_id IS NULL),
  1);

-- E a prova de que o alvo era alcancavel: a VITIMA de verdade leva o convite.
-- Sem isto a secao 4 passaria tambem se o trigger estivesse simplesmente morto.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'b0b0b0b0-0197-0000-0000-000000000006';

INSERT INTO public.profiles (id, full_name, is_public)
VALUES ('b0b0b0b0-0197-0000-0000-000000000006', 'Vitima', FALSE);

SELECT pg_temp.expect(
  'CONTRAPROVA: a dona do email de verdade recebe o convite',
  (SELECT count(*) FROM public.list_my_group_invitations()), 1);

RESET ROLE;

-- =====================================================
-- (5) CONTA NAO CONFIRMADA NAO RECLAMA NADA
-- =====================================================
-- Mesma condicao do get_user_by_email(). Enquanto o email nao esta confirmado a
-- rota tambem nao encontra a conta, entao os dois lados concordam: o convite
-- continua esperando, e nao e entregue a quem nao provou o endereco.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd0d0d0d0-0197-0000-0000-000000000001';

INSERT INTO public.group_invitations
  (id, group_id, invited_by, invite_method, invite_target, invited_user_id,
   message, expires_at)
VALUES ('33333333-0197-0000-0000-000000000003',
        '60000000-0197-0000-0000-0000000000a7',
        'd0d0d0d0-0197-0000-0000-000000000001',
        'email', 'semconf@test.local', NULL, NULL,
        NOW() + INTERVAL '14 days');

RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '50505050-0197-0000-0000-000000000004';

INSERT INTO public.profiles (id, full_name, is_public)
VALUES ('50505050-0197-0000-0000-000000000004', 'Sem confirmacao', FALSE);

SELECT pg_temp.expect(
  'conta com email NAO confirmado nao recebe o convite',
  (SELECT count(*) FROM public.list_my_group_invitations()), 0);

RESET ROLE;

SELECT pg_temp.expect(
  'o convite do email nao confirmado segue sem dono',
  (SELECT count(*) FROM public.group_invitations
    WHERE id = '33333333-0197-0000-0000-000000000003'
      AND invited_user_id IS NULL),
  1);

-- =====================================================
-- (6) O QUE O TRIGGER TEM QUE DEIXAR QUIETO
-- =====================================================
-- Quatro linhas que um UPDATE largo demais arrastaria. Todas endereçadas ao
-- mesmo email de uma conta que vai nascer logo abaixo.
INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES ('e0e0e0e0-0197-0000-0000-000000000007', 'limites@test.local', NOW());

-- O 001 poe em `group_invitations` um trigger AFTER INSERT FOR EACH ROW
-- (`cleanup_expired_invitations`) que chama `expire_old_invitations()` sob
-- `IF random() < 0.1`. Ele tem de sair do caminho aqui, e o motivo nao e
-- arrumacao: a linha (b) abaixo e PENDENTE E EXPIRADA de proposito, para que a
-- unica clausula que a exclui seja a de PRAZO. Se a varredura aleatoria a passar
-- para 'expired', quem a exclui passa a ser o filtro `status = 'pending'`
-- SOZINHO -- e o mutante que remove a clausula de prazo vira EQUIVALENTE, porque
-- deixa de ter efeito observavel.
--
-- Medido antes desta linha existir: `sem_prazo` sobrevivia em 4 de 8 execucoes,
-- variando sem nada no teste mudar, e a sonda mostrava a linha (b) chegando na
-- assercao ora como 'pending' ora como 'expired'. Um `random()` dentro de um
-- trigger de producao e nao-determinismo que o placar de mutantes le como
-- cobertura.
--
-- HMO-344 APAGOU esse trigger (migration 044), e este arquivo roda na POSICAO
-- dele na cadeia do db-verify -- depois da 039 e ANTES da 044 -- entao aqui o
-- trigger AINDA EXISTE e desligar continua sendo necessario. O condicional e
-- para o outro mundo: rodar este teste a mao contra um banco com a cadeia
-- INTEIRA (o jeito mais natural de conferir um arquivo isolado) estouraria
-- `trigger "cleanup_expired_invitations" ... does not exist`, que se le como
-- regressao e nao e. Com o IF, o arquivo passa nos dois mundos e a assercao
-- "a linha expirada chega pending" la embaixo e que garante o resultado nos
-- dois casos -- nao este bloco.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.group_invitations'::regclass
       AND NOT tgisinternal
       AND tgname = 'cleanup_expired_invitations'
  ) THEN
    ALTER TABLE public.group_invitations DISABLE TRIGGER cleanup_expired_invitations;
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd0d0d0d0-0197-0000-0000-000000000001';

INSERT INTO public.group_invitations
  (id, group_id, invited_by, invite_method, invite_target, invited_user_id,
   status, expires_at)
VALUES
  -- (a) JA TEM DONO: nao pode trocar de dono.
  ('44444444-0197-0000-0000-00000000000a',
   '60000000-0197-0000-0000-0000000000a7', 'd0d0d0d0-0197-0000-0000-000000000001',
   'email', 'limites@test.local', 'a7a7a7a7-0197-0000-0000-000000000005',
   'pending', NOW() + INTERVAL '14 days'),
  -- (b) EXPIRADO: nao ressuscita.
  ('44444444-0197-0000-0000-00000000000b',
   '60000000-0197-0000-0000-0000000000a7', 'd0d0d0d0-0197-0000-0000-000000000001',
   'email', 'limites@test.local', NULL,
   'pending', NOW() - INTERVAL '1 day'),
  -- (c) JA RECUSADO: convite respondido nao volta.
  ('44444444-0197-0000-0000-00000000000c',
   '60000000-0197-0000-0000-0000000000a7', 'd0d0d0d0-0197-0000-0000-000000000001',
   'email', 'limites@test.local', NULL,
   'rejected', NOW() + INTERVAL '14 days'),
  -- (d) OUTRO METODO: 'request' e pedido de entrada (029), e o invite_target
  --     dele nao e um endereco para onde entregar convite.
  ('44444444-0197-0000-0000-00000000000d',
   '60000000-0197-0000-0000-0000000000a7', 'd0d0d0d0-0197-0000-0000-000000000001',
   'request', 'limites@test.local', NULL,
   'pending', NOW() + INTERVAL '14 days');

RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'e0e0e0e0-0197-0000-0000-000000000007';

INSERT INTO public.profiles (id, full_name, is_public)
VALUES ('e0e0e0e0-0197-0000-0000-000000000007', 'Limites', FALSE);

RESET ROLE;

SELECT pg_temp.expect(
  'convite que ja tinha dono nao trocou de dono',
  (SELECT count(*) FROM public.group_invitations
    WHERE id = '44444444-0197-0000-0000-00000000000a'
      AND invited_user_id = 'a7a7a7a7-0197-0000-0000-000000000005'),
  1);

-- Esta assercao vem ANTES da proxima de proposito: ela e a que torna a seguinte
-- interpretavel. A linha (b) so testa a clausula de PRAZO enquanto continuar
-- `pending` -- se estiver 'expired', o filtro de status a excluiria sozinho e a
-- assercao de baixo passaria sem olhar para o prazo. Afirmar isso aqui e o que
-- impede a cobertura de virar ficcao sem ninguem notar.
SELECT pg_temp.expect(
  'a linha expirada chega na assercao ainda pending (senao o prazo fica sem teste)',
  (SELECT count(*) FROM public.group_invitations
    WHERE id = '44444444-0197-0000-0000-00000000000b'
      AND status = 'pending'
      AND expires_at < NOW()),
  1);

SELECT pg_temp.expect(
  'nenhuma das 3 linhas inelegiveis (expirada, recusada, request) foi reclamada',
  (SELECT count(*) FROM public.group_invitations
    WHERE id IN ('44444444-0197-0000-0000-00000000000b',
                 '44444444-0197-0000-0000-00000000000c',
                 '44444444-0197-0000-0000-00000000000d')
      AND invited_user_id IS NULL),
  3);

-- Condicional pelo mesmo motivo do DISABLE acima (ver HMO-344 / migration 044).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.group_invitations'::regclass
       AND NOT tgisinternal
       AND tgname = 'cleanup_expired_invitations'
  ) THEN
    ALTER TABLE public.group_invitations ENABLE TRIGGER cleanup_expired_invitations;
  END IF;
END $$;

-- =====================================================
-- (7) BACKFILL: o convite orfao de uma conta que JA existia
-- =====================================================
-- A SECAO 3 da 039 ja rodou quando esta cadeia foi aplicada, e naquele momento
-- este convite nao existia -- entao o teste chama `reclamar_convites_orfaos()`
-- de novo, que e LITERALMENTE a funcao que a migration chama no backfill. Nao ha
-- copia do predicado aqui: mutar a regra na migration quebra esta secao.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd0d0d0d0-0197-0000-0000-000000000001';

INSERT INTO public.group_invitations
  (id, group_id, invited_by, invite_method, invite_target, invited_user_id,
   message, expires_at)
VALUES ('55555555-0197-0000-0000-000000000005',
        '60000000-0197-0000-0000-0000000000a7',
        'd0d0d0d0-0197-0000-0000-000000000001',
        'email', 'ANTIGA@test.local', NULL, NULL,
        NOW() + INTERVAL '14 days');

RESET ROLE;

SELECT pg_temp.expect(
  'CONTROLE: a ANTIGA ja tem perfil, entao nenhum trigger vai disparar por ela',
  (SELECT count(*) FROM public.group_invitations
    WHERE id = '55555555-0197-0000-0000-000000000005'
      AND invited_user_id IS NULL),
  1);

SELECT pg_temp.expect(
  'o backfill reclamou exatamente 1 linha (a elegivel), e nao as 3 inelegiveis',
  (SELECT public.reclamar_convites_orfaos()::BIGINT),
  1);

SELECT pg_temp.expect(
  'o backfill entregou o convite orfao a conta que ja existia',
  (SELECT count(*) FROM public.group_invitations
    WHERE id = '55555555-0197-0000-0000-000000000005'
      AND invited_user_id = 'a7a7a7a7-0197-0000-0000-000000000005'),
  1);

SELECT pg_temp.expect(
  'e o backfill nao encostou nas linhas inelegiveis da secao 6',
  (SELECT count(*) FROM public.group_invitations
    WHERE id IN ('44444444-0197-0000-0000-00000000000b',
                 '44444444-0197-0000-0000-00000000000c',
                 '44444444-0197-0000-0000-00000000000d')
      AND invited_user_id IS NULL),
  3);

-- A ANTIGA ve o convite que o backfill entregou. Fecha o circulo: o backfill nao
-- so escreveu uma coluna, ele tornou o convite ALCANCAVEL pela tela.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a7a7a7a7-0197-0000-0000-000000000005';

-- Dois: o que o backfill acabou de entregar, e o da secao 6(a), que ja estava
-- endereçado a ela desde o INSERT.
SELECT pg_temp.expect(
  'a ANTIGA ve os 2 convites dela (o do backfill virou alcancavel pela tela)',
  (SELECT count(*) FROM public.list_my_group_invitations()), 2);

RESET ROLE;

-- =====================================================
-- (8) O BACKFILL DA MIGRATION RODOU DE VERDADE
-- =====================================================
-- As duas linhas conferidas aqui foram plantadas por
-- database/tests/039_historico_antes_da_039.sql, ANTES da 039 -- e sao a unica
-- coisa neste arquivo que a SECAO 3 da migration teve em que morder. Todo o
-- resto exercita o trigger, que so vale para conta criada depois.
--
-- Sem estas duas assercoes, "a SECAO 3 nao chama reclamar_convites_orfaos()"
-- sobrevive ao teste inteiro -- medido. E o mutante que mais custa em producao:
-- e justamente ele que deixaria os convites orfaos JA gravados invisiveis para
-- sempre, que e o relato da HMO-197.
SELECT pg_temp.expect(
  'o backfill da 039 entregou o convite orfao plantado antes dela',
  (SELECT count(*) FROM public.group_invitations
    WHERE id = '91111111-9197-0000-0000-000000000001'
      AND invited_user_id = 'a0a0a0a0-9197-0000-0000-000000000002'),
  1);

SELECT pg_temp.expect(
  'CONTROLE: e deixou orfao o convite cujo email nao tem conta nenhuma',
  (SELECT count(*) FROM public.group_invitations
    WHERE id = '92222222-9197-0000-0000-000000000002'
      AND invited_user_id IS NULL),
  1);

-- =====================================================
-- (9) SEM SECURITY DEFINER O TRIGGER FALHA EM SILENCIO
-- =====================================================
-- A policy `group_invitations_update` da 002 e
-- `USING (invited_user_id = auth.uid() OR is_group_admin(group_id))`. Quem acabou
-- de se cadastrar nao e admin, e a linha que precisa reclamar tem
-- `invited_user_id` NULO -- `NULL = auth.uid()` nao e verdadeiro. Rodando como
-- `authenticated` o UPDATE nao levanta erro: ele casa com ZERO linha, e o
-- cadastro termina com sucesso deixando o convite invisivel.
--
-- Medido, e vale registrar porque e contraintuitivo: DEFINER na casca do trigger
-- OU na funcao de casamento, qualquer uma das duas SOZINHA, ja basta -- numa
-- funcao DEFINER o `current_user` passa a ser o dono, e a chamada aninhada herda
-- isso. Entao trocar so uma das duas por INVOKER e mutante EQUIVALENTE, e nao
-- existe assercao que o mate. As duas ficam DEFINER de proposito: a de dentro
-- porque e onde o privilegio e usado, e a casca para que a chamada aninhada nunca
-- dependa de `authenticated` ter EXECUTE na funcao de backfill (que a SECAO 10
-- revoga).
--
-- Esta secao reproduz o UPDATE com a sessao de quem se cadastrou e exige o
-- resultado silencioso: zero linhas, sem erro. E a prova de que o DEFINER das
-- duas e carga, e nao enfeite.
SELECT pg_temp.expect(
  'o convite do email nao confirmado ainda esta sem dono (alvo da sonda abaixo)',
  (SELECT count(*) FROM public.group_invitations
    WHERE id = '33333333-0197-0000-0000-000000000003'
      AND invited_user_id IS NULL),
  1);

DO $$
DECLARE
  v_linhas INTEGER;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',
                     '50505050-0197-0000-0000-000000000004', TRUE);

  UPDATE public.group_invitations
     SET invited_user_id = '50505050-0197-0000-0000-000000000004'
   WHERE id = '33333333-0197-0000-0000-000000000003';

  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  RESET ROLE;

  IF v_linhas <> 0 THEN
    RAISE EXCEPTION
      'FALHA: a RLS deixou authenticated reclamar o convite (% linha(s)) -- '
      'se isso passou, a 002 foi afrouxada e o DEFINER da 039 virou opcional',
      v_linhas;
  END IF;
  RAISE NOTICE
    'ok: como authenticated o UPDATE casa com 0 linha e NAO levanta erro '
    '(e a falha silenciosa que o SECURITY DEFINER evita)';
END $$;

RESET ROLE;

-- =====================================================
-- (10) O APP NAO ALCANCA O BACKFILL
-- =====================================================
-- `reclamar_convites_orfaos()` sem argumento varre a tabela inteira. Ela e
-- SECURITY DEFINER, entao se `authenticated` pudesse chamar, qualquer usuario
-- logado teria um gatilho para reprocessar group_invitations a vontade. O
-- trigger nao depende desse GRANT (dentro de uma funcao DEFINER quem chama e o
-- dono dela) -- e e justamente isso que a secao 2 ja provou, com a NOVATA
-- inserindo o proprio perfil sob `SET ROLE authenticated`.
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM public.reclamar_convites_orfaos();
  RAISE EXCEPTION
    'FALHA: authenticated conseguiu chamar reclamar_convites_orfaos()';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: authenticated nao pode chamar o backfill (42501)';
END $$;

RESET ROLE;

ROLLBACK;
