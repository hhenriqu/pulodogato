-- =====================================================
-- HMO-344: a expiracao de convite deixa de depender de sorteio
-- =====================================================
-- O QUE CADA SECAO PROVA, E POR QUE ELA NAO E SUPERFLUA
-- -----------------------------------------------------
-- (1) CATALOGO: o trigger, a funcao dele e a varredura sairam. E a secao que
--     diz "a migration entrou", e sozinha ela nao prova comportamento nenhum.
-- (2) GUARDA DE REINTRODUCAO: nenhuma funcao de trigger de `group_invitations`
--     tem `random()`. Diferente da (1) por nao citar nome: se alguem criar
--     OUTRO trigger sorteado amanha, (1) continua verde e esta reprova.
-- (3) DETERMINISMO -- a secao que mede o defeito. Uma linha `pending` E
--     vencida sobrevive a 120 insercoes alheias ainda `pending`. ANTES da 044
--     esta secao reprovava 8 em 8 execucoes sobre o mesmo banco (medido); sob
--     `random() < 0.1`, a chance de 120 insercoes nao varrerem nada e
--     0.9^120 = 0.0003%. Depois da 044 nao ha sorteio nenhum e ela e
--     deterministica de verdade, nao "provavelmente verde".
-- (4) AS LEITURAS CONTINUAM CERTAS PELO PRAZO, NAO PELO ROTULO. E a secao que
--     justifica apagar em vez de substituir: com a linha vencida parada em
--     `pending` para sempre, as quatro leituras tem de continuar excluindo-a.
--     Cada uma vem com CONTROLE POSITIVO (uma linha pendente e NAO vencida,
--     que elas TEM de devolver) -- sem ele, uma fixture quebrada daria zero em
--     tudo e a secao passaria vacua.
-- (5) a primitiva de escrita anonima sumiu: `anon` nao tem mais como chamar
--     `expire_old_invitations()`, porque ela nao existe.
--
-- Rodar num banco limpo, depois da cadeia ate 044:
--   psql "$DB_URL" -f database/tests/044_expiracao_de_convite_sem_sorteio_test.sql
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
-- (1) CATALOGO: os tres objetos sairam
-- =====================================================
SELECT pg_temp.expect(
  'o trigger cleanup_expired_invitations nao existe mais',
  (SELECT count(*) FROM pg_trigger
    WHERE tgrelid = 'public.group_invitations'::regclass
      AND NOT tgisinternal
      AND tgname = 'cleanup_expired_invitations'),
  0);

-- Os dois nomes sao parecidos e e facil grepar o errado: o TRIGGER e
-- `cleanup_expired_invitations`, a FUNCAO que ele executava e
-- `cleanup_expired_invitations_trigger` (sufixo `_trigger`), e era nela que
-- vivia o `random()`.
SELECT pg_temp.expect(
  'a funcao cleanup_expired_invitations_trigger() nao existe mais',
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'cleanup_expired_invitations_trigger'),
  0);

SELECT pg_temp.expect(
  'a varredura expire_old_invitations() nao existe mais',
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'expire_old_invitations'),
  0);

-- =====================================================
-- (2) GUARDA DE REINTRODUCAO: nenhum trigger sorteado na tabela
-- =====================================================
-- Nao cita nome de funcao: vale para qualquer trigger que apareca em
-- `group_invitations` depois desta migration.
SELECT pg_temp.expect(
  'nenhuma funcao de trigger de group_invitations usa random()',
  (SELECT count(*) FROM pg_trigger t
     JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.group_invitations'::regclass
      AND NOT t.tgisinternal
      AND p.prosrc LIKE '%random()%'),
  0);

-- =====================================================
-- FIXTURE
-- =====================================================
-- Duas contas: quem convida (admin do grupo) e quem recebe. A segunda e quem
-- "olha" nas leituras da secao (4), entao ela precisa de auth.users + profiles.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('d0d0d0d0-0344-0000-0000-000000000001', 'dono344@test.local',     NOW()),
  ('a7a7a7a7-0344-0000-0000-000000000002', 'convidado344@test.local', NOW());

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('d0d0d0d0-0344-0000-0000-000000000001', 'Dono 344',      FALSE),
  ('a7a7a7a7-0344-0000-0000-000000000002', 'Convidado 344', FALSE);

-- Sem INSERT em `group_members` para o dono: o 001 poe em `expense_groups` o
-- trigger `add_group_creator_trigger`, que ja insere `created_by` como admin
-- ativo. Inserir a mao estoura `unique_user_per_group`.
INSERT INTO public.expense_groups (id, name, group_code, created_by)
VALUES ('60000000-0344-0000-0000-000000000344', 'Grupo 344', 'G344XYZ',
        'd0d0d0d0-0344-0000-0000-000000000001');

-- A VITIMA: `pending` e vencida de proposito. Depois da 044 nada no banco a
-- carimba, entao ela fica assim para sempre -- e e exatamente esse o estado
-- que a secao (4) exige que as leituras saibam excluir.
INSERT INTO public.group_invitations
  (id, group_id, invited_by, invite_method, invite_target, invited_user_id,
   status, expires_at)
VALUES ('cc000344-0000-0000-0000-00000000000b',
        '60000000-0344-0000-0000-000000000344',
        'd0d0d0d0-0344-0000-0000-000000000001',
        'email', 'convidado344@test.local',
        'a7a7a7a7-0344-0000-0000-000000000002',
        'pending', NOW() - INTERVAL '1 day');

SELECT pg_temp.expect_text(
  'CONTROLE: a vitima nasce pending',
  (SELECT status FROM public.group_invitations
    WHERE id = 'cc000344-0000-0000-0000-00000000000b'),
  'pending');

-- =====================================================
-- (3) DETERMINISMO: 120 insercoes alheias nao mexem na vitima
-- =====================================================
-- Sob o trigger do 001 isto reprovava: 0.9^120 = 0.0003% de chance de nenhuma
-- das 120 insercoes sortear a varredura. Medido 8/8 reprovando com apenas 60.
INSERT INTO public.group_invitations
  (group_id, invited_by, invite_method, invite_target, status, expires_at)
SELECT '60000000-0344-0000-0000-000000000344',
       'd0d0d0d0-0344-0000-0000-000000000001',
       'email', 'ruido344-' || g || '@test.local', 'pending',
       NOW() + INTERVAL '14 days'
FROM generate_series(1, 120) g;

SELECT pg_temp.expect(
  'a vitima sobrevive a 120 insercoes ainda pending (nenhuma varredura sorteada)',
  (SELECT count(*) FROM public.group_invitations
    WHERE id = 'cc000344-0000-0000-0000-00000000000b'
      AND status = 'pending'
      AND expires_at < NOW()),
  1);

-- O outro lado da mesma moeda: NENHUMA linha ficou `expired`. A assercao de
-- cima olha so a vitima; esta pega uma varredura que tivesse pego outras.
SELECT pg_temp.expect(
  'nenhum convite da tabela foi carimbado expired por insercao',
  (SELECT count(*) FROM public.group_invitations WHERE status = 'expired'),
  0);

-- =====================================================
-- (4) AS LEITURAS EXCLUEM A VENCIDA PELO PRAZO, NAO PELO ROTULO
-- =====================================================
-- O CONTROLE POSITIVO de todas as quatro: um convite pendente e NAO vencido,
-- para a MESMA pessoa, em um grupo DIFERENTE (`has_pending_invitation` e por
-- grupo, entao no mesmo grupo o positivo mascararia o negativo).
INSERT INTO public.expense_groups (id, name, group_code, created_by)
VALUES ('60000000-0344-0000-0000-000000000555', 'Grupo 344 Vivo', 'G344VIV',
        'd0d0d0d0-0344-0000-0000-000000000001');

INSERT INTO public.group_invitations
  (id, group_id, invited_by, invite_method, invite_target, invited_user_id,
   status, expires_at)
VALUES ('cc000344-0000-0000-0000-00000000000a',
        '60000000-0344-0000-0000-000000000555',
        'd0d0d0d0-0344-0000-0000-000000000001',
        'email', 'convidado344@test.local',
        'a7a7a7a7-0344-0000-0000-000000000002',
        'pending', NOW() + INTERVAL '14 days');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a7a7a7a7-0344-0000-0000-000000000002';

-- 4a. list_my_group_invitations() (030). A coluna de saida chama-se
--     `invitation_id`, nao `id` -- a tabela de retorno renomeia.
SELECT pg_temp.expect(
  'list_my_group_invitations NAO devolve a vencida (que segue pending)',
  (SELECT count(*) FROM public.list_my_group_invitations()
    WHERE invitation_id = 'cc000344-0000-0000-0000-00000000000b'),
  0);

SELECT pg_temp.expect(
  'CONTROLE POSITIVO: list_my_group_invitations devolve a nao-vencida',
  (SELECT count(*) FROM public.list_my_group_invitations()
    WHERE invitation_id = 'cc000344-0000-0000-0000-00000000000a'),
  1);

-- 4b. has_pending_invitation() (002) -- a auxiliar que a RLS usa para liberar
--     o INSERT em group_members. Se ela dissesse `true` para convite vencido,
--     a pessoa entraria no grupo com convite caducado.
SELECT pg_temp.expect_text(
  'has_pending_invitation e FALSE no grupo do convite vencido',
  (SELECT public.has_pending_invitation('60000000-0344-0000-0000-000000000344')::text),
  'false');

SELECT pg_temp.expect_text(
  'CONTROLE POSITIVO: has_pending_invitation e TRUE no grupo do convite vivo',
  (SELECT public.has_pending_invitation('60000000-0344-0000-0000-000000000555')::text),
  'true');

-- 4c. respond_to_group_invitation() (030) -- aceitar a vencida tem de falhar.
DO $$
DECLARE
  v_erro TEXT := NULL;
BEGIN
  BEGIN
    PERFORM public.respond_to_group_invitation(
      'cc000344-0000-0000-0000-00000000000b', TRUE);
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
  END;

  IF v_erro IS NULL THEN
    RAISE EXCEPTION 'FALHA: aceitar o convite VENCIDO funcionou -- a clausula de prazo de respond_to_group_invitation nao esta segurando';
  END IF;
  RAISE NOTICE 'ok: respond_to_group_invitation recusa a vencida (%)', v_erro;
END $$;

RESET ROLE;

-- 4d. reclamar_convites_orfaos() (039). Ela casa convite SEM dono contra
--     auth.users, entao a sonda precisa de uma linha orfa -- a vitima da (3)
--     tem dono. Duas orfas para o mesmo email: uma vencida, uma viva.
INSERT INTO public.group_invitations
  (id, group_id, invited_by, invite_method, invite_target, invited_user_id,
   status, expires_at)
VALUES
  ('cc000344-0000-0000-0000-00000000000c',
   '60000000-0344-0000-0000-000000000344',
   'd0d0d0d0-0344-0000-0000-000000000001',
   'email', 'convidado344@test.local', NULL,
   'pending', NOW() - INTERVAL '1 day'),
  ('cc000344-0000-0000-0000-00000000000d',
   '60000000-0344-0000-0000-000000000555',
   'd0d0d0d0-0344-0000-0000-000000000001',
   'email', 'convidado344@test.local', NULL,
   'pending', NOW() + INTERVAL '14 days');

-- Chama a funcao da migration, sem copiar o predicado dela: mutar a regra na
-- 039 quebra estas duas assercoes.
SELECT public.reclamar_convites_orfaos('a7a7a7a7-0344-0000-0000-000000000002');

SELECT pg_temp.expect(
  'reclamar_convites_orfaos NAO reclama a orfa vencida (que segue pending)',
  (SELECT count(*) FROM public.group_invitations
    WHERE id = 'cc000344-0000-0000-0000-00000000000c'
      AND invited_user_id IS NULL),
  1);

SELECT pg_temp.expect(
  'CONTROLE POSITIVO: reclamar_convites_orfaos reclama a orfa viva',
  (SELECT count(*) FROM public.group_invitations
    WHERE id = 'cc000344-0000-0000-0000-00000000000d'
      AND invited_user_id = 'a7a7a7a7-0344-0000-0000-000000000002'),
  1);

-- =====================================================
-- (5) A PRIMITIVA DE ESCRITA ANONIMA SUMIU
-- =====================================================
-- `expire_old_invitations()` era SECURITY DEFINER e nasceu no baseline sem
-- REVOKE, entao `anon` e `authenticated` tinham EXECUTE num UPDATE de tabela
-- inteira que ignora RLS. Medido no catalogo antes da 044: true nos dois.
-- Nao existindo a funcao, nao existe o privilegio -- e `to_regprocedure`
-- devolve NULL em vez de estourar, que e o que permite afirmar isso.
SELECT pg_temp.expect(
  'nao ha mais funcao expire_old_invitations para anon/authenticated chamar',
  (SELECT count(*) FROM (
     SELECT to_regprocedure('public.expire_old_invitations()') AS f
   ) s WHERE s.f IS NOT NULL),
  0);

ROLLBACK;
