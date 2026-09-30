-- =====================================================
-- HMO-201 (parte 1): a chave Pix e do grupo, nao do app inteiro
-- =====================================================
-- A 032 existe por causa de uma policy que ja esta em producao:
--
--     profiles_select_own_or_public  USING (id = auth.uid() OR is_public)
--
-- com `profiles.is_public` DEFAULT TRUE. Guardar a chave Pix em `profiles`
-- teria publicado o CPF/telefone/email de cada pessoa para toda conta
-- autenticada do app, sem que ninguem escrevesse uma linha para isso
-- acontecer. Este teste e o que impede alguem de "simplificar" a 032 de volta
-- para uma coluna em `profiles` sem perceber o que esta abrindo.
--
-- O que ele fixa:
--
--   (1) o dono grava e le a propria chave;
--   (2) o colega de grupo ATIVO le a chave -- e a feature pedida;
--   (3) CONTROLE NEGATIVO: um estranho autenticado NAO le. E esta a assercao
--       que sustenta a migration inteira, e ela e comparada contra (2) de
--       proposito: se a policy virasse "ninguem le", (2) quebra junto;
--   (4) a MESMA leitura feita sobre `profiles` continua devolvendo a linha do
--       estranho -- prova de que (3) nao e "o estranho nao enxerga nada" e sim
--       "o estranho nao enxerga a CHAVE";
--   (5) quem esta `pending` (pedido de entrada, 029) nao le;
--   (6) sair do grupo TIRA a visibilidade;
--   (7) ninguem grava chave no nome de outra pessoa (INSERT);
--   (8) ninguem MOVE a propria linha para outro user_id (UPDATE) -- a familia
--       de defeito da HMO-183;
--   (9) os CHECKs recusam chave em branco e tipo invalido.
--
-- Rodar num banco limpo, depois das migrations ate 032:
--   psql "$DB_URL" -f database/tests/hmo201_chave_pix_test.sql
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

-- Devolve a chave que a sessao corrente consegue LER para um dado dono, ou
-- '<invisivel>'. Uma sonda unica para os dois lados: e ela que faz "o colega
-- le" e "o estranho nao le" serem a mesma pergunta feita por pessoas
-- diferentes, em vez de duas consultas escritas de jeitos diferentes.
CREATE OR REPLACE FUNCTION pg_temp.pix_visivel(p_dono UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
  SELECT pix_key INTO v FROM public.user_pix_keys WHERE user_id = p_dono;
  RETURN COALESCE(v, '<invisivel>');
END $$;

-- Tenta escrever e devolve o SQLSTATE em vez de deixar a excecao abortar o
-- teste.
CREATE OR REPLACE FUNCTION pg_temp.tenta_gravar(
  p_dono UUID, p_chave TEXT, p_tipo TEXT
) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.user_pix_keys (user_id, pix_key, pix_key_type)
  VALUES (p_dono, p_chave, p_tipo);
  RETURN 'gravou';
EXCEPTION
  WHEN insufficient_privilege THEN RETURN 'ERRO:42501';
  WHEN check_violation        THEN RETURN 'ERRO:23514';
  WHEN unique_violation       THEN RETURN 'ERRO:23505';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.tenta_mover(p_de UUID, p_para UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.user_pix_keys SET user_id = p_para WHERE user_id = p_de;
  RETURN 'moveu ' || (SELECT count(*) FROM public.user_pix_keys WHERE user_id = p_para);
EXCEPTION
  WHEN insufficient_privilege THEN RETURN 'ERRO:42501';
END $$;

-- A MESMA tentativa, SEM `WHERE`. Nao e capricho, e a unica forma que exercita
-- a policy de UPDATE de verdade -- e isso so ficou claro quando o mutante
-- `update_larga` sobreviveu ao teste acima.
--
-- Com `WHERE`, o Postgres precisa LER a linha, entao a policy de SELECT entra
-- na jogada e ele ainda exige que a linha NOVA continue visivel para quem
-- escreveu. Mover a chave para o user_id de uma estranha deixa a linha
-- invisivel para o autor, e a escrita e recusada -- mesmo com a policy de
-- UPDATE totalmente aberta. Medido: com `USING (TRUE) WITH CHECK (TRUE)` a
-- versao com WHERE continua levando 42501, e a versao sem WHERE PASSA.
--
-- Ou seja: a policy de UPDATE e load-bearing exatamente para o comando que nao
-- le nada antes de escrever. Sem esta sonda, afrouxa-la nao quebraria teste
-- nenhum.
CREATE OR REPLACE FUNCTION pg_temp.tenta_mover_tudo(p_para UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.user_pix_keys SET user_id = p_para;
  RETURN 'moveu';
EXCEPTION
  WHEN insufficient_privilege THEN RETURN 'ERRO:42501';
  WHEN unique_violation       THEN RETURN 'ERRO:23505';
END $$;

-- DONA e COLEGA dividem o grupo Casa. PENDENTE pediu entrada e nao foi
-- aprovada. ESTRANHA tem conta no app e nenhum grupo em comum -- e o usuario
-- tipico do app, que e exatamente de quem a chave precisa estar escondida.
INSERT INTO auth.users (id, email) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'dona@test.local'),
  ('c1000000-0000-0000-0000-000000000002', 'colega@test.local'),
  ('c1000000-0000-0000-0000-000000000003', 'estranha@test.local'),
  ('c1000000-0000-0000-0000-000000000004', 'pendente@test.local');

-- `is_public = TRUE` de proposito em TODAS: e o default de producao, e e o que
-- torna a assercao (4) uma medicao do buraco real em vez de um cenario
-- inventado.
INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'Dona',     TRUE),
  ('c1000000-0000-0000-0000-000000000002', 'Colega',   TRUE),
  ('c1000000-0000-0000-0000-000000000003', 'Estranha', TRUE),
  ('c1000000-0000-0000-0000-000000000004', 'Pendente', TRUE);

INSERT INTO public.expense_groups (id, name, group_code, group_type, created_by)
VALUES ('c2000000-0000-0000-0000-0000000000a1', 'Casa', 'PIX001', 'private',
        'c1000000-0000-0000-0000-000000000001');

-- A dona NAO entra nesta lista: criar o grupo ja a matricula como admin ativa
-- por trigger (001_baseline), e repetir a linha bate em `unique_user_per_group`.
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('c2000000-0000-0000-0000-0000000000a1', 'c1000000-0000-0000-0000-000000000002', 'member', 'active'),
  ('c2000000-0000-0000-0000-0000000000a1', 'c1000000-0000-0000-0000-000000000004', 'member', 'pending');

SELECT pg_temp.expect('a dona entrou no grupo pelo trigger, como ativa',
  (SELECT count(*) FROM public.group_members
    WHERE group_id = 'c2000000-0000-0000-0000-0000000000a1'
      AND user_id  = 'c1000000-0000-0000-0000-000000000001'
      AND status   = 'active'), 1);

-- =====================================================
-- (1) A dona grava e le a propria chave
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'c1000000-0000-0000-0000-000000000001';

SELECT pg_temp.expect_txt('a dona grava a propria chave',
  pg_temp.tenta_gravar('c1000000-0000-0000-0000-000000000001',
                       'dona@test.local', 'email'), 'gravou');

SELECT pg_temp.expect_txt('a dona le a propria chave',
  pg_temp.pix_visivel('c1000000-0000-0000-0000-000000000001'), 'dona@test.local');

-- =====================================================
-- (7) Ninguem grava chave no nome de outra pessoa
-- =====================================================
-- Ainda como a dona: tentar cadastrar a chave DA ESTRANHA apontando para o
-- Pix dela mesma seria como o colega do grupo recebe o Pix errado.
SELECT pg_temp.expect_txt('a dona NAO grava chave no nome da estranha',
  pg_temp.tenta_gravar('c1000000-0000-0000-0000-000000000003',
                       'dona@test.local', 'email'), 'ERRO:42501');

-- =====================================================
-- (9) Os CHECKs
-- =====================================================
-- A dona ja tem linha, entao apagamos antes para que o que barre seja o CHECK
-- e nao a PK -- senao as duas assercoes abaixo passariam por 23505 e nao
-- provariam CHECK nenhum.
DELETE FROM public.user_pix_keys WHERE user_id = 'c1000000-0000-0000-0000-000000000001';

SELECT pg_temp.expect_txt('chave so de espacos e recusada',
  pg_temp.tenta_gravar('c1000000-0000-0000-0000-000000000001', '   ', 'email'),
  'ERRO:23514');

SELECT pg_temp.expect_txt('tipo fora da lista e recusado',
  pg_temp.tenta_gravar('c1000000-0000-0000-0000-000000000001', '11999990000', 'whatsapp'),
  'ERRO:23514');

-- Regrava a chave de verdade para o resto do teste.
SELECT pg_temp.expect_txt('a dona regrava a chave',
  pg_temp.tenta_gravar('c1000000-0000-0000-0000-000000000001',
                       'dona@test.local', 'email'), 'gravou');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- =====================================================
-- (2) O colega de grupo ATIVO le a chave -- a feature
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'c1000000-0000-0000-0000-000000000002';

SELECT pg_temp.expect_txt('o colega de grupo ativo LE a chave da dona',
  pg_temp.pix_visivel('c1000000-0000-0000-0000-000000000001'), 'dona@test.local');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- =====================================================
-- (3) CONTROLE NEGATIVO: a estranha NAO le
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'c1000000-0000-0000-0000-000000000003';

SELECT pg_temp.expect_txt('a estranha NAO le a chave da dona',
  pg_temp.pix_visivel('c1000000-0000-0000-0000-000000000001'), '<invisivel>');

-- =====================================================
-- (4) ...e nao e porque ela nao enxerga nada
-- =====================================================
-- A mesma sessao, a mesma dona, a tabela em que a chave TERIA ficado se a 032
-- fosse uma coluna em `profiles`. Esta linha volta. E por isso que (3) nao e
-- trivial: a estranha ve a dona, ve o nome dela, e mesmo assim nao ve a chave.
SELECT pg_temp.expect_txt('a estranha ENXERGA o perfil publico da dona',
  (SELECT full_name FROM public.profiles
    WHERE id = 'c1000000-0000-0000-0000-000000000001'), 'Dona');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- =====================================================
-- (5) Quem esta pending nao le
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'c1000000-0000-0000-0000-000000000004';

SELECT pg_temp.expect_txt('quem esta na fila de aprovacao NAO le a chave',
  pg_temp.pix_visivel('c1000000-0000-0000-0000-000000000001'), '<invisivel>');

-- ...e ela consegue cadastrar a PROPRIA chave. Isto nao e generosidade: e o
-- que torna a assercao (5b) abaixo possivel de medir. Sem uma chave gravada
-- no nome da pendente, "o membro ativo nao ve a chave dela" passaria porque
-- nao ha chave nenhuma -- uma assercao que nasce verdadeira e nunca reprova.
SELECT pg_temp.expect_txt('a pendente cadastra a propria chave',
  pg_temp.tenta_gravar('c1000000-0000-0000-0000-000000000004',
                       '11988887777', 'telefone'), 'gravou');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- =====================================================
-- (5b) ...e o membro ATIVO tambem nao ve a chave de quem esta pending
-- =====================================================
-- A direcao contraria de (5), e ela escapou da primeira versao deste teste: o
-- mutante que apagava `dele.status = 'active'` de `compartilha_grupo_ativo`
-- sobrevivia, porque todas as assercoes de bloqueio olhavam para o lado de
-- QUEM LE. Alguem que so pediu para entrar no grupo ainda nao foi aprovada por
-- ninguem; o grupo nao tem direito ao Pix dela antes disso.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'c1000000-0000-0000-0000-000000000002';

SELECT pg_temp.expect_txt('o membro ativo NAO le a chave de quem esta pending',
  pg_temp.pix_visivel('c1000000-0000-0000-0000-000000000004'), '<invisivel>');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- =====================================================
-- (8) Ninguem move a propria linha para outro user_id
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'c1000000-0000-0000-0000-000000000001';

-- Publicar o Pix DELA no nome da estranha faria o colega do grupo copiar a
-- chave achando que paga a estranha. As duas formas do comando estao aqui
-- porque elas passam por policies DIFERENTES -- ver a nota em
-- `pg_temp.tenta_mover_tudo`.
SELECT pg_temp.expect_txt('a dona NAO move a propria linha para a estranha',
  pg_temp.tenta_mover('c1000000-0000-0000-0000-000000000001',
                      'c1000000-0000-0000-0000-000000000003'), 'ERRO:42501');

SELECT pg_temp.expect_txt('nem com um UPDATE sem WHERE, que nao le nada antes',
  pg_temp.tenta_mover_tudo('c1000000-0000-0000-0000-000000000003'), 'ERRO:42501');

SELECT pg_temp.expect('a linha da dona continua no nome dela',
  (SELECT count(*) FROM public.user_pix_keys
    WHERE user_id = 'c1000000-0000-0000-0000-000000000001'), 1);

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- =====================================================
-- (6) Sair do grupo tira a visibilidade
-- =====================================================
-- O colega LIA a chave na assercao (2). Tirar o `active` dele e a unica coisa
-- que muda aqui, e a leitura tem que apagar junto. Sem isto, "ex-membro" seria
-- um estado que a policy nunca testou -- e sair de um grupo de viagem e o
-- caminho mais comum para alguem deixar de ter direito ao Pix dos outros.
-- 'inactive' e o valor que a rota de sair do grupo grava; 'left' nem existe no
-- `group_members_status_check` (001 + 020), e usar um valor invalido aqui
-- faria a assercao passar por motivo nenhum se o UPDATE fosse silencioso.
UPDATE public.group_members SET status = 'inactive'
  WHERE group_id = 'c2000000-0000-0000-0000-0000000000a1'
    AND user_id  = 'c1000000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'c1000000-0000-0000-0000-000000000002';

SELECT pg_temp.expect_txt('ex-membro NAO le mais a chave da dona',
  pg_temp.pix_visivel('c1000000-0000-0000-0000-000000000001'), '<invisivel>');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

ROLLBACK;
