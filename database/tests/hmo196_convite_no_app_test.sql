-- =====================================================
-- HMO-196: o convite de grupo entregue DENTRO do app
-- =====================================================
-- O relato: "estou tentando convidar a leticia.macoliver@gmail.com para o grupo
-- Casa de codigo 3103F9, e ela nao recebeu o convite". A descricao da issue
-- atribuiu isso a falta de envio de email. Nao era: medido em producao,
-- `group_invitations` tinha 5 INSERTs e a conta dela existe e esta confirmada.
-- O convite era gravado, endereçado a ela, e o app nao mostrava -- porque o sino
-- montava a tela com dois embeds do PostgREST que a RLS esconde de quem ainda
-- nao aceitou, e o hook descartava em silencio qualquer convite com embed nulo.
--
-- O canal foi escolhido pelo H.: "Nao usaremos email, sera enviando um convite
-- para o usuario referente daquele email".
--
-- As secoes 1 e 2 sao o CONTROLE: elas afirmam o estado antigo (o convite e
-- legivel, o grupo e o perfil de quem convidou NAO sao). Sao elas que justificam
-- as duas funcoes existirem em vez de "simplificar" para um SELECT com embed --
-- se alguem afrouxar `expense_groups_select` ou `profiles_select_own_or_public`
-- para "consertar a tela", estas duas assercoes quebram e dizem por que.
--
-- Rodar num banco limpo, depois da cadeia ate 030_convite_de_grupo_no_app.sql:
--   psql "$DB_URL" -f database/tests/hmo196_convite_no_app_test.sql
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

-- DONA = admin que convida.  CONVIDADA = a conta dona do email convidado.
-- ESTRANHA = terceiro sem relacao nenhuma com o grupo.
INSERT INTO auth.users (id, email) VALUES
  ('d0d0d0d0-0196-0000-0000-000000000001', 'dona@test.local'),
  ('a0a0a0a0-0196-0000-0000-000000000002', 'convidada@test.local'),
  ('c0c0c0c0-0196-0000-0000-000000000003', 'estranha@test.local');

-- `full_name` da DONA fica NULO de proposito: e o estado real da conta do relato
-- em producao, e o convite tem que aparecer mesmo assim (a secao 3 cobre).
INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('d0d0d0d0-0196-0000-0000-000000000001', NULL,         FALSE),
  ('a0a0a0a0-0196-0000-0000-000000000002', 'Convidada',  FALSE),
  ('c0c0c0c0-0196-0000-0000-000000000003', 'Estranha',   FALSE);

-- Grupo PRIVADO, o default e o caso do relato. O trigger add_group_creator_trigger
-- poe a dona como admin ativa sozinho.
INSERT INTO public.expense_groups (id, name, description, group_code, group_type, created_by)
VALUES ('60000000-0196-0000-0000-0000000000a3', 'Casa de codigo', 'A casa',
        'A196F9', 'private', 'd0d0d0d0-0196-0000-0000-000000000001');

-- =====================================================
-- (1) O ADMIN convida, pela RLS de verdade
-- =====================================================
-- Mesma escrita que /api/expense-groups/invite faz. `invited_user_id` preenchido
-- e o coracao do canal escolhido: e por ele que o convite acha a pessoa. Um
-- convite com esse campo NULO nao e visivel para ninguem, nunca -- e por isso que
-- a rota passou a RECUSAR quando nao consegue resolver o email.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd0d0d0d0-0196-0000-0000-000000000001';

INSERT INTO public.group_invitations
  (id, group_id, invited_by, invite_method, invite_target, invited_user_id,
   message, expires_at)
VALUES ('11111111-0196-0000-0000-000000000001',
        '60000000-0196-0000-0000-0000000000a3',
        'd0d0d0d0-0196-0000-0000-000000000001',
        'email', 'convidada@test.local',
        'a0a0a0a0-0196-0000-0000-000000000002',
        'vem pro grupo', NOW() + INTERVAL '14 days');

RESET ROLE;

-- =====================================================
-- (2) CONTROLE: o convite e legivel, mas a tela dele nao monta
-- =====================================================
-- Este e o defeito exato da HMO-196, afirmado linha por linha. As tres
-- assercoes juntas sao a razao de `list_my_group_invitations()` existir.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0a0a0a0-0196-0000-0000-000000000002';

SELECT pg_temp.expect('a convidada LE o proprio convite (a RLS da 002 permite)',
  (SELECT count(*) FROM public.group_invitations
    WHERE invited_user_id = 'a0a0a0a0-0196-0000-0000-000000000002'
      AND status = 'pending'), 1);

-- embed group:expense_groups(...) -> nulo. E correto: convidada nao e membro.
SELECT pg_temp.expect('mas NAO ve o grupo -- o embed do sino vinha nulo',
  (SELECT count(*) FROM public.expense_groups
    WHERE id = '60000000-0196-0000-0000-0000000000a3'), 0);

-- embed inviter:profiles(...) -> nulo. Tambem correto: perfil nao e publico.
SELECT pg_temp.expect('nem o perfil de quem convidou -- o outro embed nulo',
  (SELECT count(*) FROM public.profiles
    WHERE id = 'd0d0d0d0-0196-0000-0000-000000000001'), 0);

-- =====================================================
-- (3) A funcao entrega o convite montado
-- =====================================================
SELECT pg_temp.expect('list_my_group_invitations devolve o convite',
  (SELECT count(*) FROM public.list_my_group_invitations()), 1);

SELECT pg_temp.expect_text('e com o NOME do grupo, que o SELECT cru nao alcanca',
  (SELECT group_name FROM public.list_my_group_invitations()), 'Casa de codigo');

SELECT pg_temp.expect_text('a mensagem do convite vem junto',
  (SELECT invite_message FROM public.list_my_group_invitations()), 'vem pro grupo');

-- O convite NAO pode depender de quem convidou ter preenchido o nome. Medido:
-- com um filtro `AND p.full_name IS NOT NULL` na 030, a assercao de count logo
-- acima cai para 0 -- mesmo sintoma de antes, convite sumido.
--
-- O que este teste NAO consegue distinguir, e vale dito para ninguem confiar
-- demais nele: trocar o `LEFT JOIN public.profiles` da 030 por um JOIN interno
-- passa por aqui inteiro. E nao e furo do teste -- e que os dois sao mesmo
-- equivalentes hoje, porque `invited_by` e NOT NULL com FK para `profiles(id)`,
-- entao a linha de perfil sempre existe. Nao ha fixture legal que separe os
-- dois; o LEFT JOIN fica como defesa se essa FK mudar, nao como algo coberto.
SELECT pg_temp.expect_text('inviter_name NULO nao faz o convite desaparecer',
  (SELECT inviter_name FROM public.list_my_group_invitations()), NULL);

-- Decisao de privacidade da 030, fixada aqui porque o sino antigo exibia o
-- codigo: quem recusa um convite nao sai com a chave de entrada do grupo na mao.
SELECT pg_temp.expect('a funcao NAO expoe group_code',
  (SELECT count(*) FROM information_schema.routines r
     JOIN information_schema.parameters pa
       ON pa.specific_name = r.specific_name
    WHERE r.routine_schema = 'public'
      AND r.routine_name = 'list_my_group_invitations'
      AND pa.parameter_name = 'group_code'), 0);

-- A LISTA EXATA de colunas de saida, e nao so a ausencia de uma.
--
-- Estes nomes sao o contrato com o TypeScript: PostgREST usa a coluna de saida
-- como chave do JSON, e as duas telas leem `invitation_id`, `group_name`,
-- `inviter_name`... direto. Renomear uma coluna aqui nao quebra nada no banco e
-- passa pelo `tsc` -- o campo simplesmente chega `undefined` e a tela mostra
-- vazio, que e exatamente a familia de defeito silencioso da HMO-196. Conferido
-- contra `GroupInvitationNotification` (lib/hooks/useNotifications.ts) e
-- `GroupInvitation` (lib/hooks/useGroupInvitations.ts): as duas interfaces tem
-- estes nove campos, com estes nomes.
--
-- Se este teste falhar depois de uma mudanca deliberada na 030, as duas
-- interfaces TypeScript precisam mudar no mesmo commit.
SELECT pg_temp.expect_text('as colunas de saida sao exatamente as que o app le',
  (SELECT string_agg(pa.parameter_name, ',' ORDER BY pa.ordinal_position)
     FROM information_schema.routines r
     JOIN information_schema.parameters pa
       ON pa.specific_name = r.specific_name
    WHERE r.routine_schema = 'public'
      AND r.routine_name = 'list_my_group_invitations'),
  'invitation_id,group_id,group_name,group_description,inviter_name,'
  || 'inviter_avatar_url,invite_message,expires_at,created_at');

-- O mesmo para a funcao de responder: a rota /api/expense-groups/join le
-- `group_id`, `group_name` e `member_status` do resultado. `p_invitation_id` e
-- `p_accept` entram na contagem porque sao parametros de ENTRADA -- estao aqui
-- de proposito, para que trocar a ordem ou o nome deles (a rota chama por nome,
-- `{ p_invitation_id, p_accept }`) tambem reprove.
SELECT pg_temp.expect_text('a assinatura de respond_to_group_invitation e a que a rota chama',
  (SELECT string_agg(pa.parameter_name, ',' ORDER BY pa.ordinal_position)
     FROM information_schema.routines r
     JOIN information_schema.parameters pa
       ON pa.specific_name = r.specific_name
    WHERE r.routine_schema = 'public'
      AND r.routine_name = 'respond_to_group_invitation'),
  'p_invitation_id,p_accept,group_id,group_name,member_status');

RESET ROLE;

-- =====================================================
-- (4) O convite e de quem foi convidado, e de mais ninguem
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'c0c0c0c0-0196-0000-0000-000000000003';

SELECT pg_temp.expect('a estranha nao ve convite nenhum na lista dela',
  (SELECT count(*) FROM public.list_my_group_invitations()), 0);

-- Mesmo sabendo o UUID do convite, responder por ele nao encontra linha: o
-- filtro `invited_user_id = auth.uid()` mora DENTRO da funcao, nao no argumento.
DO $$
BEGIN
  PERFORM public.respond_to_group_invitation(
    '11111111-0196-0000-0000-000000000001', TRUE);
  RAISE EXCEPTION 'FALHA: a estranha aceitou o convite de outra pessoa';
EXCEPTION
  WHEN no_data_found THEN
    RAISE NOTICE 'ok: a estranha nao consegue aceitar convite alheio';
END $$;

RESET ROLE;

SELECT pg_temp.expect('e ela nao entrou no grupo',
  (SELECT count(*) FROM public.group_members
    WHERE group_id = '60000000-0196-0000-0000-0000000000a3'
      AND user_id  = 'c0c0c0c0-0196-0000-0000-000000000003'), 0);

-- =====================================================
-- (5) Aceitar entra como ATIVA, e so entao o grupo aparece
-- =====================================================
-- Convite de admin nao passa pela fila de aprovacao: quem convidou foi o proprio
-- admin, entao o aceite E a aprovacao. Isso e diferente da entrada por codigo em
-- grupo privado, que nasce `pending` porque ninguem chamou aquela pessoa.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0a0a0a0-0196-0000-0000-000000000002';

SELECT pg_temp.expect_text('aceitar devolve o nome do grupo (era o TypeError -> 500)',
  (SELECT group_name FROM public.respond_to_group_invitation(
     '11111111-0196-0000-0000-000000000001', TRUE)), 'Casa de codigo');

SELECT pg_temp.expect('a convidada virou membro ATIVA',
  (SELECT count(*) FROM public.group_members
    WHERE group_id = '60000000-0196-0000-0000-0000000000a3'
      AND user_id  = 'a0a0a0a0-0196-0000-0000-000000000002'
      AND status   = 'active'), 1);

SELECT pg_temp.expect('e agora ela VE o grupo',
  (SELECT count(*) FROM public.expense_groups
    WHERE id = '60000000-0196-0000-0000-0000000000a3'), 1);

-- Sem isto, o sino continuaria oferecendo Aceitar um convite ja aceito.
SELECT pg_temp.expect('o convite saiu da lista dela',
  (SELECT count(*) FROM public.list_my_group_invitations()), 0);

-- Segundo clique em Aceitar: o convite nao esta mais `pending`, entao a funcao
-- recusa em vez de mexer na linha de membro de novo.
DO $$
BEGIN
  PERFORM public.respond_to_group_invitation(
    '11111111-0196-0000-0000-000000000001', TRUE);
  RAISE EXCEPTION 'FALHA: aceitou duas vezes o mesmo convite';
EXCEPTION
  WHEN no_data_found THEN
    RAISE NOTICE 'ok: aceitar duas vezes nao passa';
END $$;

RESET ROLE;

SELECT pg_temp.expect_text('o convite ficou accepted, com responded_at',
  (SELECT status FROM public.group_invitations
    WHERE id = '11111111-0196-0000-0000-000000000001'), 'accepted');

SELECT pg_temp.expect('responded_at foi carimbado',
  (SELECT count(*) FROM public.group_invitations
    WHERE id = '11111111-0196-0000-0000-000000000001'
      AND responded_at IS NOT NULL), 1);

-- =====================================================
-- (6) Recusar NAO coloca ninguem no grupo
-- =====================================================
INSERT INTO public.group_invitations
  (id, group_id, invited_by, invite_method, invite_target, invited_user_id, expires_at)
VALUES ('22222222-0196-0000-0000-000000000002',
        '60000000-0196-0000-0000-0000000000a3',
        'd0d0d0d0-0196-0000-0000-000000000001',
        'email', 'estranha@test.local',
        'c0c0c0c0-0196-0000-0000-000000000003', NOW() + INTERVAL '14 days');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'c0c0c0c0-0196-0000-0000-000000000003';

SELECT pg_temp.expect_text('recusar responde rejected',
  (SELECT member_status FROM public.respond_to_group_invitation(
     '22222222-0196-0000-0000-000000000002', FALSE)), 'rejected');

RESET ROLE;

SELECT pg_temp.expect('quem recusou NAO entrou no grupo',
  (SELECT count(*) FROM public.group_members
    WHERE group_id = '60000000-0196-0000-0000-0000000000a3'
      AND user_id  = 'c0c0c0c0-0196-0000-0000-000000000003'), 0);

SELECT pg_temp.expect_text('e o convite ficou rejected',
  (SELECT status FROM public.group_invitations
    WHERE id = '22222222-0196-0000-0000-000000000002'), 'rejected');

-- =====================================================
-- (7) Convite expirado nao aparece e nao pode ser aceito
-- =====================================================
-- O `expires_at` de 14 dias que a rota grava so vale se alguem respeitar; estas
-- duas assercoes sao quem respeita.
INSERT INTO public.group_invitations
  (id, group_id, invited_by, invite_method, invite_target, invited_user_id,
   status, expires_at)
VALUES ('33333333-0196-0000-0000-000000000003',
        '60000000-0196-0000-0000-0000000000a3',
        'd0d0d0d0-0196-0000-0000-000000000001',
        'email', 'estranha@test.local',
        'c0c0c0c0-0196-0000-0000-000000000003',
        'pending', NOW() - INTERVAL '1 day');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'c0c0c0c0-0196-0000-0000-000000000003';

SELECT pg_temp.expect('convite vencido nao entra na lista',
  (SELECT count(*) FROM public.list_my_group_invitations()), 0);

DO $$
BEGIN
  PERFORM public.respond_to_group_invitation(
    '33333333-0196-0000-0000-000000000003', TRUE);
  RAISE EXCEPTION 'FALHA: aceitou um convite vencido';
EXCEPTION
  WHEN no_data_found THEN
    RAISE NOTICE 'ok: convite vencido nao pode ser aceito';
END $$;

RESET ROLE;

-- =====================================================
-- (8) Grupo arquivado nao entrega convite
-- =====================================================
-- Arquivar um grupo (020) nao apaga os convites pendentes dele. Sem o filtro
-- `g.is_active`, um convite de meses atras ressuscitaria a pessoa dentro de um
-- grupo que o admin ja tirou do ar.
INSERT INTO public.group_invitations
  (id, group_id, invited_by, invite_method, invite_target, invited_user_id, expires_at)
VALUES ('44444444-0196-0000-0000-000000000004',
        '60000000-0196-0000-0000-0000000000a3',
        'd0d0d0d0-0196-0000-0000-000000000001',
        'email', 'estranha2@test.local',
        'c0c0c0c0-0196-0000-0000-000000000003', NOW() + INTERVAL '14 days');

UPDATE public.expense_groups SET is_active = FALSE
  WHERE id = '60000000-0196-0000-0000-0000000000a3';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'c0c0c0c0-0196-0000-0000-000000000003';

SELECT pg_temp.expect('convite de grupo arquivado nao aparece',
  (SELECT count(*) FROM public.list_my_group_invitations()), 0);

DO $$
BEGIN
  PERFORM public.respond_to_group_invitation(
    '44444444-0196-0000-0000-000000000004', TRUE);
  RAISE EXCEPTION 'FALHA: entrou num grupo arquivado';
EXCEPTION
  WHEN no_data_found THEN
    RAISE NOTICE 'ok: nao da para entrar em grupo arquivado';
END $$;

RESET ROLE;

UPDATE public.expense_groups SET is_active = TRUE
  WHERE id = '60000000-0196-0000-0000-0000000000a3';

-- =====================================================
-- (9) anon nao executa nenhuma das duas
-- =====================================================
-- As duas sao SECURITY DEFINER e leem `expense_groups`/`profiles` por cima da
-- RLS. Para `anon` o auth.uid() e NULL e o resultado seria vazio de todo jeito,
-- mas "vazio por sorte" e diferente de "sem permissao".
SELECT pg_temp.expect('anon NAO executa list_my_group_invitations',
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'list_my_group_invitations'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')), 0);

SELECT pg_temp.expect('anon NAO executa respond_to_group_invitation',
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'respond_to_group_invitation'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')), 0);

-- E authenticated PRECISA executar, senao o sino nasce vazio para todo mundo.
SELECT pg_temp.expect('authenticated executa as duas',
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('list_my_group_invitations', 'respond_to_group_invitation')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')), 2);

ROLLBACK;
