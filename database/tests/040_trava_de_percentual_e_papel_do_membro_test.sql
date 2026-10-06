-- =====================================================
-- Teste da trava de percentual e papel do membro (040)
-- =====================================================
-- A HMO-268 descreve o membro comum reescrevendo a PROPRIA linha de
-- `group_members`: `percentage` (o peso do rateio a partir da fase 4, HMO-270)
-- e `role` (a promocao a admin, que so a rota impede hoje). A policy
-- `group_members_update` do 002 nao compara OLD com NEW e nao restringe coluna,
-- entao o ramo `user_id = auth.uid()` entrega a linha inteira.
--
-- ===========================================================================
-- A ARMADILHA DESTE ARQUIVO, E O QUE ELE FAZ CONTRA ELA
-- ===========================================================================
-- Escrita barrada pela RLS volta SUCESSO COM ZERO LINHAS, nao erro. Um teste
-- que so confira "o percentual nao mudou" passa verde em tres mundos
-- diferentes, e dois deles sao o defeito:
--
--   1. o trigger recusou          <- o unico que este arquivo quer provar
--   2. a RLS nao entregou a linha <- passaria igual SEM trigger nenhum
--   3. o UPDATE nem foi tentado   <- typo no WHERE, fixture errada
--
-- Por isso toda recusa aqui passa por `pg_temp.recusa()`, que exige as DUAS
-- coisas: excecao (nao "0 linhas") E o SQLSTATE 42501 com um TRECHO DA MENSAGEM
-- do trigger. O trecho nao e preciosismo: `permission denied for function
-- is_group_admin` tambem e 42501, e e exatamente o que acontece se alguem
-- revogar o GRANT do 002 achando que endurece o banco (SECAO 7). Sem casar a
-- mensagem, esse estado -- em que o ADMIN perde a capacidade de configurar a
-- divisao -- sairia verde neste arquivo.
--
-- A SECAO 3 mostra o mundo (2) de verdade, com um UPDATE que a RLS descarta em
-- silencio, para que a diferenca fique registrada e nao vire folclore.
--
-- ===========================================================================
-- O QUE CADA SECAO RESPONDE
-- ===========================================================================
--   1. CONTROLE POSITIVO DO BURACO: sem o trigger, o ataque funciona? As tres
--      escritas voltam `UPDATE 1` e a linha fica com 0,01% e `role = 'admin'`
--      noutro grupo. Sem esta secao o arquivo nao distingue "a trava funciona"
--      de "nunca houve o que travar", e as duas sairiam verdes;
--   2. com o trigger, o membro comum e RECUSADO: percentual para baixo e para
--      cima, papel, e as duas colunas de identidade da linha;
--   3. a demonstracao do falso verde: UPDATE descartado pela RLS nao levanta
--      erro nenhum -- e por isso que a SECAO 2 asserta mensagem;
--   4. CONTROLE POSITIVO DO PRODUTO: o admin CONSEGUE. Percentual de outro
--      membro, percentual proprio, e promover e rebaixar -- que e o que
--      `split-config/route.ts` e `members/[memberId]/role/route.ts` escrevem.
--      Uma trava que tranca o vazamento e o produto junto nao serve;
--   5. os fluxos que passam pelo trigger sem mexer nas quatro colunas
--      continuam passando: sair do grupo, arquivar, restaurar, aprovar
--      pedido -- e `join_group_by_code()`, que chega aqui por
--      `ON CONFLICT ... DO UPDATE` e e chamada por quem NAO e admin;
--   6. `auth.uid() IS NULL` passa direto (service_role, cron, psql);
--   7. a prova de que a assercao da SECAO 2 nao e vacua: com o EXECUTE de
--      `is_group_admin` revogado, o 42501 muda de dono -- a recusa que o
--      arquivo exige deixa de casar, e o caminho do admin cai.
--
-- Rodar depois de 001 -> ... -> 040:
--   psql "$DB_URL" -f database/tests/040_trava_de_percentual_e_papel_do_membro_test.sql
--
-- Qualquer FALHA lanca excecao e aborta. Termina em ROLLBACK.
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- O coracao do arquivo -- ver "A ARMADILHA" no cabecalho.
--
-- `comando` e executado por EXECUTE para que o erro possa ser capturado sem
-- abortar a transacao inteira; o bloco EXCEPTION e o que cria o subtransacao
-- necessaria. Tres desfechos distintos, e so um passa:
--
--   * nao levantou nada -> FALHA, com a contagem de linhas no texto. Zero
--     linhas cai AQUI, e e o falso verde que esta funcao existe para pegar;
--   * levantou 42501 com `trecho` na mensagem -> ok;
--   * levantou 42501 sem o trecho -> FALHA, mostrando a mensagem recebida.
--     E o caso do `permission denied for function`;
--   * levantou outro SQLSTATE -> nao e capturado, sobe e aborta o arquivo com
--     o erro original, que e a informacao mais util nesse caso (um CHECK
--     violado, por exemplo, significaria que a fixture nao faz o que diz).
CREATE OR REPLACE FUNCTION pg_temp.recusa(rotulo TEXT, comando TEXT, trecho TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_linhas BIGINT;
  v_msg    TEXT;
BEGIN
  BEGIN
    EXECUTE comando;
    GET DIAGNOSTICS v_linhas = ROW_COUNT;
    RAISE EXCEPTION
      'FALHA: % -> o comando NAO foi recusado: nenhuma excecao, % linha(s) afetada(s). '
      'Atencao: "0 linha(s)" e recusa da RLS, nao do trigger -- o trigger tem de levantar 42501.',
      rotulo, v_linhas;
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_msg := SQLERRM;
      IF position(trecho IN v_msg) = 0 THEN
        RAISE EXCEPTION
          'FALHA: % -> veio 42501, mas de outro lugar: "%". Esperava a mensagem do trigger, contendo "%".',
          rotulo, v_msg, trecho;
      END IF;
      RAISE NOTICE 'ok: % -> recusado com 42501 ("%")', rotulo, v_msg;
  END;
END $$;

-- =====================================================
-- Fixture
-- =====================================================
-- A e admin; B e membro comum do mesmo grupo; E e um ex-membro de um grupo
-- PUBLICO, que vai voltar pela SECAO 5.
--
-- `group_members_user_id_fkey` aponta para `profiles`, nao para `auth.users`
-- (001:2175) -- as duas linhas sao necessarias: `auth.users` para o claim fazer
-- sentido, `profiles` para a FK fechar.
INSERT INTO auth.users (id, email) VALUES
  ('aaaa0040-0000-0000-0000-00000000000a', 'admin@g040.local'),
  ('aaaa0040-0000-0000-0000-00000000000b', 'membro@g040.local'),
  ('aaaa0040-0000-0000-0000-00000000000e', 'exmembro@g040.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('aaaa0040-0000-0000-0000-00000000000a', 'Admin A', FALSE),
  ('aaaa0040-0000-0000-0000-00000000000b', 'Membro B', FALSE),
  ('aaaa0040-0000-0000-0000-00000000000e', 'Ex-membro E', FALSE);

-- G1 e o grupo da conta; G2 e o alvo da mudanca de `group_id` -- um grupo em
-- que o B nunca entrou; G3 e publico, para a volta pelo codigo na SECAO 5.
--
-- Inserir o grupo JA CRIA a linha do criador como admin/active (trigger do
-- 001), entao a linha do A nao e inserida aqui -- inseri-la daria
-- `unique_user_per_group`.
INSERT INTO public.expense_groups (id, name, created_by, group_type, group_code) VALUES
  ('bbbb0040-0000-0000-0000-000000000001', 'Apartamento',  'aaaa0040-0000-0000-0000-00000000000a', 'private', 'G40PR1'),
  ('bbbb0040-0000-0000-0000-000000000002', 'Grupo alheio', 'aaaa0040-0000-0000-0000-00000000000a', 'private', 'G40PR2'),
  ('bbbb0040-0000-0000-0000-000000000003', 'Republica',    'aaaa0040-0000-0000-0000-00000000000a', 'public',  'G40PUB');

INSERT INTO public.group_members (id, group_id, user_id, role, status, percentage) VALUES
  ('cccc0040-0000-0000-0000-00000000000b', 'bbbb0040-0000-0000-0000-000000000001',
   'aaaa0040-0000-0000-0000-00000000000b', 'member', 'active', 50.00),
  -- O E saiu do grupo publico. `status = 'removed'` e o unico estado em que
  -- `join_group_by_code()` chega ao `DO UPDATE` -- 'active' e 'pending' saem
  -- antes, por RAISE e por RETURN (029:118 e :128). O percentual de 30,00 fica
  -- na linha de proposito: e o que prova, na SECAO 5, que voltar ao grupo nao
  -- esbarra na trava de `percentage`.
  ('cccc0040-0000-0000-0000-00000000000e', 'bbbb0040-0000-0000-0000-000000000003',
   'aaaa0040-0000-0000-0000-00000000000e', 'member', 'removed', 30.00);

-- Este UPDATE roda como `postgres`, com `auth.uid()` NULO, e e o primeiro a
-- passar pelo trigger: se a saida antecipada da guarda nao existisse, a
-- fixture morreria aqui. A SECAO 6 volta ao assunto de proposito.
UPDATE public.group_members SET percentage = 50.00
 WHERE group_id = 'bbbb0040-0000-0000-0000-000000000001'
   AND user_id  = 'aaaa0040-0000-0000-0000-00000000000a';

SELECT pg_temp.expect(
  'fixture: 50/50 no grupo do aluguel',
  (SELECT string_agg(percentage::TEXT, '/' ORDER BY role)
     FROM public.group_members
    WHERE group_id = 'bbbb0040-0000-0000-0000-000000000001'),
  '50.00/50.00');

SELECT pg_temp.expect(
  'fixture: o trigger da 040 esta instalado',
  (SELECT count(*)::TEXT FROM pg_trigger
    WHERE tgrelid = to_regclass('public.group_members')
      AND tgname = 'trg_group_members_guard' AND NOT tgisinternal),
  '1');

-- =====================================================
-- 1. CONTROLE POSITIVO DO BURACO: sem o trigger, o ataque funciona
-- =====================================================
-- DDL e transacional no Postgres, entao da para derrubar o trigger, provar que
-- o buraco e real, e recria-lo -- tudo dentro da transacao que termina em
-- ROLLBACK. Sem esta secao o arquivo poderia estar provando que um ataque
-- impossivel continua impossivel.
DROP TRIGGER trg_group_members_guard ON public.group_members;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0040-0000-0000-0000-00000000000b';

-- "eu pago 0,01% do aluguel", a frase da issue.
UPDATE public.group_members SET percentage = 0.01
 WHERE id = 'cccc0040-0000-0000-0000-00000000000b';
-- A promocao que a rota so deixa admin fazer.
UPDATE public.group_members SET role = 'admin'
 WHERE id = 'cccc0040-0000-0000-0000-00000000000b';
-- E a mudanca de grupo, que leva o `role = 'admin'` acima para um grupo que
-- nunca convidou o B.
UPDATE public.group_members SET group_id = 'bbbb0040-0000-0000-0000-000000000002'
 WHERE id = 'cccc0040-0000-0000-0000-00000000000b';

RESET ROLE;
-- O claim sobrevive ao RESET ROLE: limpar aqui, senao a proxima secao roda sob
-- a identidade do B sem dizer que roda.
SET LOCAL request.jwt.claim.sub = '';

SELECT pg_temp.expect(
  'SEM a trava, o B fica com 0,01% / admin / noutro grupo',
  (SELECT percentage::TEXT || ' / ' || role || ' / ' ||
          (SELECT name FROM public.expense_groups eg WHERE eg.id = gm.group_id)
     FROM public.group_members gm WHERE gm.id = 'cccc0040-0000-0000-0000-00000000000b'),
  '0.01 / admin / Grupo alheio');

-- Desfaz o estrago e repoe a trava, para as secoes seguintes rodarem no banco
-- que a 040 realmente produz.
UPDATE public.group_members
   SET percentage = 50.00, role = 'member',
       group_id = 'bbbb0040-0000-0000-0000-000000000001'
 WHERE id = 'cccc0040-0000-0000-0000-00000000000b';

CREATE TRIGGER trg_group_members_guard
  BEFORE UPDATE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.group_members_guard();

SELECT pg_temp.expect(
  'a linha do B voltou ao estado original',
  (SELECT percentage::TEXT || ' / ' || role FROM public.group_members
    WHERE id = 'cccc0040-0000-0000-0000-00000000000b'),
  '50.00 / member');

-- =====================================================
-- 2. COM a trava, o membro comum e RECUSADO
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0040-0000-0000-0000-00000000000b';

SELECT pg_temp.recusa(
  'B baixando o proprio percentual para 0,01',
  $$UPDATE public.group_members SET percentage = 0.01
     WHERE id = 'cccc0040-0000-0000-0000-00000000000b'$$,
  'so um admin do grupo muda o percentual de divisao do membro');

-- Para cima tambem nao. Nao e simetria decorativa: num grupo de dois, subir o
-- proprio peso e o jeito de baixar o do outro sem tocar na linha dele -- a
-- soma e que vira dinheiro, e ela nao mora em nenhuma das duas linhas.
SELECT pg_temp.recusa(
  'B subindo o proprio percentual para 99,99',
  $$UPDATE public.group_members SET percentage = 99.99
     WHERE id = 'cccc0040-0000-0000-0000-00000000000b'$$,
  'so um admin do grupo muda o percentual de divisao do membro');

-- E NULO, que e o caso que nenhuma das duas linhas acima alcanca.
--
-- `percentage` e a UNICA das quatro colunas que aceita nulo (001:1215 --
-- `numeric(5,2) DEFAULT 0.00`, sem NOT NULL; as outras tres sao NOT NULL, e
-- mandar nulo nelas morre num 23502 antes de o trigger opinar). Entao e so
-- aqui que a escolha de `IS DISTINCT FROM` em vez de `<>` tem consequencia:
-- com `<>`, comparar 50.00 com NULL da NULL, que nao e TRUE, o IF nao entra e
-- a guarda passa ao largo -- o membro comum zera o proprio peso mandando
-- `{"percentage": null}` num PATCH, em vez do `0.01` que as linhas de cima
-- tentam, e sai pela porta que o operador errado deixaria aberta.
--
-- MEDIDO: trocar `IS DISTINCT FROM` por `<>` nesta guarda deixava o arquivo
-- INTEIRO verde antes desta assercao existir, e o mesmo UPDATE gravava NULL de
-- verdade na linha do B. Com ela, o mutante morre aqui.
SELECT pg_temp.recusa(
  'B anulando o proprio percentual (o caso que `<>` deixaria passar)',
  $$UPDATE public.group_members SET percentage = NULL
     WHERE id = 'cccc0040-0000-0000-0000-00000000000b'$$,
  'so um admin do grupo muda o percentual de divisao do membro');

SELECT pg_temp.recusa(
  'B se promovendo a admin',
  $$UPDATE public.group_members SET role = 'admin'
     WHERE id = 'cccc0040-0000-0000-0000-00000000000b'$$,
  'so um admin do grupo muda o papel do membro');

-- As duas colunas de identidade, congeladas para todo mundo. Esta primeira e
-- a que encadeia com a de cima: `role` travado nao basta se a linha pode se
-- mudar para outro grupo levando o papel que ja tem.
SELECT pg_temp.recusa(
  'B mudando a propria linha para outro grupo',
  $$UPDATE public.group_members SET group_id = 'bbbb0040-0000-0000-0000-000000000002'
     WHERE id = 'cccc0040-0000-0000-0000-00000000000b'$$,
  'linha de group_members nao troca de grupo');

SELECT pg_temp.recusa(
  'B apontando a propria linha para o A',
  $$UPDATE public.group_members SET user_id = 'aaaa0040-0000-0000-0000-00000000000a'
     WHERE id = 'cccc0040-0000-0000-0000-00000000000b'$$,
  'linha de group_members nao troca de pessoa');

-- Tudo junto numa tacada, que e como um PATCH do PostgREST chega de verdade.
SELECT pg_temp.recusa(
  'B mandando percentual e papel no mesmo UPDATE',
  $$UPDATE public.group_members SET percentage = 0.01, role = 'admin'
     WHERE id = 'cccc0040-0000-0000-0000-00000000000b'$$,
  'so um admin do grupo muda o percentual de divisao do membro');

-- E sem WHERE: o UPDATE que nao LE linha antes de escrever, e por isso o unico
-- que nao passa pelo SELECT da RLS. A policy de UPDATE sozinha o deixaria
-- passar na linha do proprio B (ver a nota do 032 sobre isso), e e o trigger
-- que tem de recusar.
SELECT pg_temp.recusa(
  'B mandando UPDATE sem WHERE',
  $$UPDATE public.group_members SET percentage = 0.01$$,
  'so um admin do grupo muda o percentual de divisao do membro');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

SELECT pg_temp.expect(
  'depois das oito tentativas, o grupo segue 50/50 e sem admin novo',
  (SELECT string_agg(percentage::TEXT || ':' || role, ' ' ORDER BY role)
     FROM public.group_members
    WHERE group_id = 'bbbb0040-0000-0000-0000-000000000001'),
  '50.00:admin 50.00:member');

-- =====================================================
-- 3. O FALSO VERDE, de corpo presente
-- =====================================================
-- O B tenta mudar o percentual do ADMIN. A policy de UPDATE exige
-- `user_id = auth.uid() OR is_group_admin(group_id)`, e nenhum dos dois vale
-- para o B na linha do A -- a linha e DESCARTADA. Nao ha erro, nao ha trigger,
-- nao ha nada: `UPDATE 0` e sucesso.
--
-- Esta secao nao prova seguranca nenhuma. Ela existe para registrar, dentro do
-- arquivo, o desfecho que um teste ingenuo confundiria com a trava funcionando
-- -- e que `pg_temp.recusa()` reprova de proposito.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0040-0000-0000-0000-00000000000b';

DO $$
DECLARE v_linhas BIGINT;
BEGIN
  UPDATE public.group_members SET percentage = 0.01
   WHERE group_id = 'bbbb0040-0000-0000-0000-000000000001'
     AND user_id  = 'aaaa0040-0000-0000-0000-00000000000a';
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  IF v_linhas <> 0 THEN
    RAISE EXCEPTION
      'FALHA: a RLS entregou ao B a linha do admin (% linha(s)) -- a policy de UPDATE mudou', v_linhas;
  END IF;
  RAISE NOTICE
    'ok: a RLS descartou a linha do admin em SILENCIO (UPDATE 0, sem erro) -- e por isso que a SECAO 2 exige mensagem';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- =====================================================
-- 4. CONTROLE POSITIVO DO PRODUTO: o admin consegue
-- =====================================================
-- Sem esta secao a 040 poderia ser "ninguem muda percentual nunca", que passa
-- todas as recusas acima e entrega a fase 4 sem como configurar a divisao.
-- E o que `split-config/route.ts:263` e `members/[memberId]/role/route.ts:100`
-- escrevem, com o admin de verdade na sessao.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0040-0000-0000-0000-00000000000a';

UPDATE public.group_members SET percentage = 70.00
 WHERE id = 'cccc0040-0000-0000-0000-00000000000b';

SELECT pg_temp.expect(
  'o admin muda o percentual do outro membro',
  (SELECT percentage::TEXT FROM public.group_members
    WHERE id = 'cccc0040-0000-0000-0000-00000000000b'),
  '70.00');

-- O proprio percentual do admin tambem: ele entra no rateio como qualquer um,
-- e 70/30 so fecha se ele puder escrever os 30 dele.
UPDATE public.group_members SET percentage = 30.00
 WHERE group_id = 'bbbb0040-0000-0000-0000-000000000001'
   AND user_id  = 'aaaa0040-0000-0000-0000-00000000000a';

SELECT pg_temp.expect(
  'o admin muda o proprio percentual, e o grupo fecha 100',
  (SELECT sum(percentage)::TEXT FROM public.group_members
    WHERE group_id = 'bbbb0040-0000-0000-0000-000000000001'),
  '100.00');

-- O upsert da rota de divisao manda `group_id` e `user_id` junto (precisa: ver
-- o cabecalho de split-config/route.ts), com os valores LIDOS do banco. Reenviar
-- valor igual nao e mudanca -- `IS DISTINCT FROM` da falso -- e o congelamento
-- das duas colunas de identidade nao pode pegar o fluxo real.
UPDATE public.group_members
   SET percentage = 40.00,
       group_id   = 'bbbb0040-0000-0000-0000-000000000001',
       user_id    = 'aaaa0040-0000-0000-0000-00000000000b'
 WHERE id = 'cccc0040-0000-0000-0000-00000000000b';

SELECT pg_temp.expect(
  'reenviar group_id e user_id iguais nao e mudanca de identidade',
  (SELECT percentage::TEXT FROM public.group_members
    WHERE id = 'cccc0040-0000-0000-0000-00000000000b'),
  '40.00');

-- Promover e rebaixar, o que a rota de `role` faz.
UPDATE public.group_members SET role = 'admin'
 WHERE id = 'cccc0040-0000-0000-0000-00000000000b';

SELECT pg_temp.expect(
  'o admin promove o membro',
  (SELECT role FROM public.group_members
    WHERE id = 'cccc0040-0000-0000-0000-00000000000b'),
  'admin');

UPDATE public.group_members SET role = 'member'
 WHERE id = 'cccc0040-0000-0000-0000-00000000000b';

SELECT pg_temp.expect(
  'o admin rebaixa de volta',
  (SELECT role FROM public.group_members
    WHERE id = 'cccc0040-0000-0000-0000-00000000000b'),
  'member');

-- E o admin TAMBEM nao troca a linha de grupo nem de pessoa: as duas sao
-- congeladas para todo mundo, porque nao sao edicao -- sao transformar a
-- participacao de alguem na de outro, com o `id` que `group_expense_splits` e
-- `group_member_proportions` referenciam por FK.
SELECT pg_temp.recusa(
  'nem o admin muda a linha de grupo',
  $$UPDATE public.group_members SET group_id = 'bbbb0040-0000-0000-0000-000000000002'
     WHERE id = 'cccc0040-0000-0000-0000-00000000000b'$$,
  'linha de group_members nao troca de grupo');

SELECT pg_temp.recusa(
  'nem o admin muda a linha de pessoa',
  $$UPDATE public.group_members SET user_id = 'aaaa0040-0000-0000-0000-00000000000e'
     WHERE id = 'cccc0040-0000-0000-0000-00000000000b'$$,
  'linha de group_members nao troca de pessoa');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- =====================================================
-- 5. OS FLUXOS REAIS CONTINUAM PASSANDO
-- =====================================================
-- Toda escrita em `group_members` passa por este trigger agora. As que nao
-- tocam nenhuma das quatro colunas tem de atravessar sem reparo -- feitas por
-- quem NAO e admin, que e o caso que quebraria.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0040-0000-0000-0000-00000000000b';

-- Sair do grupo (`leave/route.ts`: status + left_at; `left_at` nao existe no
-- schema versionado, entao aqui vai o que a coluna real suporta).
UPDATE public.group_members SET status = 'removed'
 WHERE id = 'cccc0040-0000-0000-0000-00000000000b';

SELECT pg_temp.expect(
  'o membro comum sai do grupo',
  (SELECT status FROM public.group_members
    WHERE id = 'cccc0040-0000-0000-0000-00000000000b'),
  'removed');

UPDATE public.group_members SET status = 'active'
 WHERE id = 'cccc0040-0000-0000-0000-00000000000b';

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- `join_group_by_code()` chega ao trigger por `ON CONFLICT ... DO UPDATE`, que
-- DISPARA BEFORE UPDATE. O E e um ex-membro do grupo publico, com 30,00 na
-- linha velha, e NAO e admin de nada: se o trigger exigisse admin para
-- qualquer UPDATE, ou se o `DO UPDATE` tocasse `role`, voltar ao grupo passaria
-- a ser recusado justamente para quem esta voltando.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0040-0000-0000-0000-00000000000e';

SELECT pg_temp.expect(
  'o ex-membro volta ao grupo publico pelo codigo',
  (SELECT member_status FROM public.join_group_by_code('G40PUB')),
  'active');

SELECT pg_temp.expect(
  'voltar nao mexeu no percentual nem no papel da linha antiga',
  (SELECT percentage::TEXT || ' / ' || role FROM public.group_members
    WHERE id = 'cccc0040-0000-0000-0000-00000000000e'),
  '30.00 / member');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- Arquivar e restaurar, que o admin faz sobre a linha dos OUTROS
-- (`[groupId]/route.ts:399` e `restore/route.ts:92`).
--
-- O QUE SE MEDE AQUI E `ROW_COUNT`, E NAO UM `count(*)` DEPOIS
-- -----------------------------------------------------------
-- Contar linhas DEPOIS, ainda como `authenticated`, nao mede o trigger: ao
-- arquivar, a linha do proprio admin sai de 'active', `is_group_member` exige
-- `status = 'active'` (002:237) e a policy de SELECT passa a devolver so a
-- linha dele -- o `count(*)` volta 1 com as DUAS linhas arquivadas no banco.
-- Seria um falso vermelho vindo da LEITURA, sobre uma escrita que funcionou.
-- `ROW_COUNT` e o numero de linhas que a escrita realmente tocou, que e a
-- pergunta: o trigger deixou passar?
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0040-0000-0000-0000-00000000000a';

DO $$
DECLARE v_linhas BIGINT;
BEGIN
  UPDATE public.group_members SET status = 'archived', archived_at = now()
   WHERE group_id = 'bbbb0040-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  IF v_linhas <> 2 THEN
    RAISE EXCEPTION 'FALHA: o admin arquivou % linha(s) do grupo, esperado 2', v_linhas;
  END IF;
  RAISE NOTICE 'ok: o admin arquiva as duas linhas do grupo (o trigger nao pega)';
END $$;

-- A restauracao alcanca UMA linha, nao duas, e isso NAO e a 040
-- ---------------------------------------------------------------
-- Com a propria linha em 'archived', o admin deixa de ser admin para a RLS:
-- `is_group_admin` tambem exige `status = 'active'` (002:252). A policy de
-- UPDATE cai no ramo `user_id = auth.uid()`, que so alcanca a linha dele -- a
-- do B e descartada em silencio, e o grupo fica meio restaurado.
--
-- Medido com o trigger da 040 DERRUBADO: `UPDATE 1` igual. E comportamento da
-- policy do 002, anterior a esta migration, e esta assercao existe para que
-- ninguem leia o `1` como estrago da trava. Esta registrado como achado
-- separado na HMO-268 -- `restore/route.ts` nao restaura os outros membros.
DO $$
DECLARE v_linhas BIGINT;
BEGIN
  UPDATE public.group_members SET status = 'active', archived_at = NULL, restored_at = now()
   WHERE group_id = 'bbbb0040-0000-0000-0000-000000000001' AND status = 'archived';
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  IF v_linhas <> 1 THEN
    RAISE EXCEPTION
      'FALHA: a restauracao tocou % linha(s). 1 e o comportamento da policy do 002 '
      '(admin arquivado nao e admin); 2 significa que a policy mudou e esta nota esta velha; '
      '0 significa que algo passou a barrar a escrita.', v_linhas;
  END IF;
  RAISE NOTICE 'ok: o admin restaura a propria linha, e o trigger nao interfere';
END $$;

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- Fora da RLS, para separar o que foi ESCRITO do que o admin consegue LER.
SELECT pg_temp.expect(
  'no banco: a linha do admin voltou, a do B seguiu arquivada (achado do 002)',
  (SELECT string_agg(status, ' ' ORDER BY role) FROM public.group_members
    WHERE group_id = 'bbbb0040-0000-0000-0000-000000000001'),
  'active archived');

-- Devolve o grupo ao estado util para a SECAO 6, sem claim (auth.uid() nulo).
UPDATE public.group_members SET status = 'active', archived_at = NULL
 WHERE group_id = 'bbbb0040-0000-0000-0000-000000000001';

-- =====================================================
-- 6. auth.uid() NULO passa direto
-- =====================================================
-- `service_role`, cron e psql direto: backend nosso, que precisa poder corrigir
-- cadastro de membro e rodar backfill. Nao e brecha para o app -- `anon` levou
-- `REVOKE ALL` da tabela no 002, e um `authenticated` sem claim nao recebe
-- linha nenhuma da RLS (os dois lados do OR dao NULL ou FALSE).
SELECT pg_temp.expect(
  'nesta sessao auth.uid() e nulo',
  (SELECT coalesce(auth.uid()::TEXT, '<nulo>')),
  '<nulo>');

UPDATE public.group_members SET percentage = 11.00, role = 'admin'
 WHERE id = 'cccc0040-0000-0000-0000-00000000000b';

SELECT pg_temp.expect(
  'sem claim, o backend muda percentual e papel',
  (SELECT percentage::TEXT || ' / ' || role FROM public.group_members
    WHERE id = 'cccc0040-0000-0000-0000-00000000000b'),
  '11.00 / admin');

UPDATE public.group_members SET percentage = 40.00, role = 'member'
 WHERE id = 'cccc0040-0000-0000-0000-00000000000b';

-- =====================================================
-- 7. A assercao da SECAO 2 nao e vacua
-- =====================================================
-- O corpo do trigger chama `public.is_group_admin`, e chamada de funcao dentro
-- do corpo e checada NO DISPARO. Se alguem revogar o GRANT do 002 achando que
-- endurece o banco, a trava nao abre -- ela falha FECHADA, com
-- `permission denied for function is_group_admin`. Isso e 42501, o MESMO
-- SQLSTATE das recusas legitimas.
--
-- Esta secao e o controle negativo da forma de asserir do arquivo: com o
-- EXECUTE revogado, (a) a recusa deixa de casar a mensagem do trigger, e um
-- teste que olhasse so o SQLSTATE continuaria verde; e (b) o ADMIN perde a
-- capacidade de configurar a divisao, que e a regressao de produto que isso
-- causaria.
REVOKE EXECUTE ON FUNCTION public.is_group_admin(UUID) FROM authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0040-0000-0000-0000-00000000000a';

DO $$
DECLARE v_msg TEXT;
BEGIN
  UPDATE public.group_members SET percentage = 45.00
   WHERE id = 'cccc0040-0000-0000-0000-00000000000b';
  RAISE EXCEPTION
    'FALHA: com o EXECUTE revogado, o UPDATE do admin passou -- o trigger nao esta chamando is_group_admin';
EXCEPTION
  WHEN insufficient_privilege THEN
    v_msg := SQLERRM;
    IF position('is_group_admin' IN v_msg) = 0 THEN
      RAISE EXCEPTION
        'FALHA: esperava o 42501 da funcao revogada, veio "%"', v_msg;
    END IF;
    RAISE NOTICE
      'ok: sem o GRANT do 002 o trigger falha FECHADO, e o 42501 vem da funcao ("%") -- nao da trava', v_msg;
END $$;

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- E a prova de que era SO o GRANT: devolvido, o admin volta a conseguir.
GRANT EXECUTE ON FUNCTION public.is_group_admin(UUID) TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0040-0000-0000-0000-00000000000a';

UPDATE public.group_members SET percentage = 45.00
 WHERE id = 'cccc0040-0000-0000-0000-00000000000b';

SELECT pg_temp.expect(
  'com o GRANT de volta, o admin configura a divisao de novo',
  (SELECT percentage::TEXT FROM public.group_members
    WHERE id = 'cccc0040-0000-0000-0000-00000000000b'),
  '45.00');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

DO $$ BEGIN
  RAISE NOTICE '040: trava de percentual e papel do membro -- todas as secoes ok';
END $$;

ROLLBACK;
