-- =====================================================
-- HMO-190 (2a volta): o pedido pendente precisa ser dizivel e visivel
-- =====================================================
-- O relato: "ela esta dizendo que ja faz parte do grupo mas o grupo nao esta
-- aparecendo para ela". Ela nao inventou isso -- o app afirmou. Digitar o
-- codigo uma segunda vez batia no `IF v_current IN ('active','pending')` da
-- `join_group_by_code`, que levantava 23505 para os DOIS estados, e a rota
-- traduzia 23505 para "You are already a member of this group".
--
-- A 029 separa os dois casos e da a quem pediu como enxergar o proprio pedido.
-- Este teste fixa as duas pontas, e principalmente a que NAO pode afrouxar:
--
--   (1) pedir de novo, pendente, devolve 'pending' em vez de estourar;
--   (2) pedir de novo nao rejuvenesce a fila do admin;
--   (3) quem esta pendente ve o NOME do grupo por my_pending_group_requests(),
--       e continua sem ver a linha de expense_groups;
--   (4) my_pending_group_requests() nao mostra o pedido de outra pessoa;
--   (5) CONTROLE NEGATIVO: quem ja esta `active` continua levando 23505 --
--       ou seja, a 029 nao transformou a funcao num "entra sempre";
--   (6) depois de aprovada, o pedido some da lista de pendentes.
--
-- Rodar num banco limpo, depois das migrations ate 029:
--   psql "$DB_URL" -f database/tests/hmo190_pedido_de_entrada_visivel_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_txt(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- Chama a RPC e devolve o que ACONTECEU, em vez de deixar a excecao abortar o
-- teste: ou o member_status retornado, ou o SQLSTATE. E assim que da para
-- afirmar tanto "devolveu pending" quanto "continuou recusando com 23505" com
-- a mesma sonda -- e e o 23505 do caso `active` que impede esta migration de
-- virar um "qualquer um entra".
CREATE OR REPLACE FUNCTION pg_temp.tenta_entrar(p_code TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
  SELECT member_status INTO v FROM public.join_group_by_code(p_code);
  RETURN COALESCE(v, '<nenhuma linha>');
EXCEPTION
  WHEN unique_violation THEN RETURN 'ERRO:23505';
  WHEN no_data_found    THEN RETURN 'ERRO:P0002';
END $$;

-- DONA = admin do grupo; NOVA = quem digita o codigo; TERCEIRA = outra
-- pendente, no mesmo grupo, para provar o isolamento da funcao nova.
INSERT INTO auth.users (id, email) VALUES
  ('d0d0d0d0-0000-0000-0000-000000000001', 'dona@test.local'),
  ('a0a0a0a0-0000-0000-0000-000000000002', 'nova@test.local'),
  ('e0e0e0e0-0000-0000-0000-000000000004', 'terceira@test.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('d0d0d0d0-0000-0000-0000-000000000001', 'Dona do grupo', FALSE),
  ('a0a0a0a0-0000-0000-0000-000000000002', 'Convidada', FALSE),
  ('e0e0e0e0-0000-0000-0000-000000000004', 'Terceira', FALSE);

-- Grupo PRIVADO: e o do relato (Casa de codigo, 3103F9).
INSERT INTO public.expense_groups (id, name, group_code, group_type, created_by)
VALUES ('60000000-0000-0000-0000-0000000000a3', 'Casa', '3103F9', 'private',
        'd0d0d0d0-0000-0000-0000-000000000001');

-- =====================================================
-- (1) Pedir de novo, ainda pendente, NAO e "voce ja e membro"
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0a0a0a0-0000-0000-0000-000000000002';

SELECT pg_temp.expect_txt('o primeiro pedido nasce pending',
  pg_temp.tenta_entrar('3103F9'), 'pending');

-- O CORACAO DESTA MIGRATION. Antes da 029 esta chamada devolvia ERRO:23505, e
-- era esse 23505 que a rota apresentava como "voce ja e membro deste grupo" --
-- a frase que fez a usuaria ir falar com o dono do grupo.
SELECT pg_temp.expect_txt('pedir DE NOVO repete o pending em vez de estourar',
  pg_temp.tenta_entrar('3103F9'), 'pending');

SELECT pg_temp.expect('o pedido repetido nao duplicou a linha',
  (SELECT count(*) FROM public.group_members
    WHERE group_id = '60000000-0000-0000-0000-0000000000a3'
      AND user_id  = 'a0a0a0a0-0000-0000-0000-000000000002'), 1);

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- =====================================================
-- (2) Pedir de novo nao rejuvenesce a fila do admin
-- =====================================================
-- Carimbo antigo plantado a mao. Sem isso a assercao nasceria FALSA: NOW() e o
-- horario da TRANSACAO, entao o `updated_at = NOW()` do ON CONFLICT gravaria
-- exatamente o mesmo valor que ja esta la e um `updated_at` inalterado nao
-- provaria nada. Com o carimbo de 2020, remover o RETURN antecipado da 029 faz
-- o ON CONFLICT reescrever para 2026 e esta assercao quebra.
UPDATE public.group_members SET updated_at = '2020-01-01 00:00:00+00'
  WHERE group_id = '60000000-0000-0000-0000-0000000000a3'
    AND user_id  = 'a0a0a0a0-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0a0a0a0-0000-0000-0000-000000000002';

SELECT pg_temp.expect_txt('pedir de novo ainda devolve pending',
  pg_temp.tenta_entrar('3103F9'), 'pending');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

SELECT pg_temp.expect('o pedido repetido NAO reescreveu o carimbo do pedido',
  (SELECT count(*) FROM public.group_members
    WHERE group_id = '60000000-0000-0000-0000-0000000000a3'
      AND user_id  = 'a0a0a0a0-0000-0000-0000-000000000002'
      AND updated_at = '2020-01-01 00:00:00+00'), 1);

-- =====================================================
-- (3) A pendente ve o NOME do grupo, e so isso
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0a0a0a0-0000-0000-0000-000000000002';

SELECT pg_temp.expect_txt('my_pending_group_requests() da o nome do grupo',
  (SELECT group_name FROM public.my_pending_group_requests()
    WHERE group_id = '60000000-0000-0000-0000-0000000000a3'), 'Casa');

-- A RLS continua exatamente como estava: a funcao nova nao abriu a tabela.
-- Se esta assercao cair, a 029 virou um vazamento -- pendente lendo o grupo.
SELECT pg_temp.expect('a pendente CONTINUA sem ver a linha de expense_groups',
  (SELECT count(*) FROM public.expense_groups
    WHERE id = '60000000-0000-0000-0000-0000000000a3'), 0);

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- =====================================================
-- (4) O pedido de uma NAO aparece para a outra
-- =====================================================
INSERT INTO public.group_members (group_id, user_id, role, status)
  VALUES ('60000000-0000-0000-0000-0000000000a3',
          'e0e0e0e0-0000-0000-0000-000000000004', 'member', 'pending');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0a0a0a0-0000-0000-0000-000000000002';

-- Duas pendentes no mesmo grupo; cada uma enxerga so o proprio pedido. Sem o
-- filtro `user_id = auth.uid()` dentro da funcao DEFINER, viriam 2 linhas.
SELECT pg_temp.expect('a convidada ve 1 pedido -- o dela, nao o da terceira',
  (SELECT count(*) FROM public.my_pending_group_requests()), 1);

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- =====================================================
-- (5) CONTROLE NEGATIVO: quem ja e membro ATIVO leva 23505
-- =====================================================
-- Esta e a assercao que impede o "conserto" preguicoso. Se alguem remover o
-- ramo `v_current = 'active'` junto com o de 'pending' -- ou trocar o IF por um
-- retorno incondicional --, a funcao vira "entra sempre" e este teste quebra.
-- Aqui o 23505 e a resposta CERTA: a pessoa e membro mesmo, e o grupo aparece
-- pra ela, entao dizer "voce ja e membro" e verdade verificavel.
UPDATE public.group_members SET status = 'active'
  WHERE group_id = '60000000-0000-0000-0000-0000000000a3'
    AND user_id  = 'a0a0a0a0-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0a0a0a0-0000-0000-0000-000000000002';

SELECT pg_temp.expect_txt('membro ATIVO pedindo de novo continua recusado',
  pg_temp.tenta_entrar('3103F9'), 'ERRO:23505');

-- Codigo que nao existe continua 404, e nao uma entrada silenciosa.
SELECT pg_temp.expect_txt('codigo inexistente continua recusado',
  pg_temp.tenta_entrar('ZZZZZZ'), 'ERRO:P0002');

-- =====================================================
-- (6) Aprovada, ela some da lista de pendentes
-- =====================================================
-- Senao o cartao "aguardando aprovacao" ficaria na tela dela para sempre, ao
-- lado do grupo de verdade -- que e a mesma familia de confusao que abriu esta
-- issue, so que do outro lado.
SELECT pg_temp.expect('aprovada, ela nao tem mais pedido pendente',
  (SELECT count(*) FROM public.my_pending_group_requests()), 0);

SELECT pg_temp.expect('e agora ela ve o grupo de verdade',
  (SELECT count(*) FROM public.expense_groups
    WHERE id = '60000000-0000-0000-0000-0000000000a3'), 1);

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

ROLLBACK;
