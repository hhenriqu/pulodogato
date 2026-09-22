-- =====================================================
-- PULODOGATO -- VALIDACAO PASSO 8: conexoes entre usuarios (010)
-- =====================================================
-- GERADO por scripts/gen-validation-bundle.mjs. Nao edite este arquivo:
-- a fonte e database/migrations/*.sql e database/tests/rls_isolation_test.sql.
--
-- Rode DEPOIS do 01_migrations.sql, no mesmo projeto descartavel.
--
-- Confere o que o 010 sozinho nao prova. A assercao central e o CONSENTIMENTO:
-- quem pede uma conexao nao pode aceita-la sozinho -- nem por UPDATE, nem gravando
-- a linha ja como 'accepted' de saida. Conexao aceita e o que habilita puxar
-- alguem para o rateio de uma despesa, entao uma conexao que nasce aceita e uma
-- pessoa entrando na vida financeira de outra sem ter clicado em nada.
--
-- Confere tambem que o par e unico NOS DOIS SENTIDOS (senao A->B e B->A viram dois
-- pedidos pendentes, e aceitar um deixa o outro pendente para sempre), que o
-- bloqueio dura -- quem foi recusado nao apaga a propria linha de bloqueio para
-- pedir de novo --, que um terceiro nao enxerga nem apaga a conexao alheia, que
-- uma conexao ja respondida nao volta para pendente, que os NOMES das duas
-- foreign keys existem (a PostgREST resolve o embed do perfil pelo nome da
-- constraint; com nome diferente a tabela existe e a tela continua quebrada), e
-- que anon nao tem privilegio nenhum. Tudo dentro de BEGIN/ROLLBACK.
--
-- O teste tem DOIS CONTROLES NEGATIVOS no fim: ele reintroduz as duas regras
-- quebradas e exige que o defeito volte a acontecer. Se eles nao dispararem, o
-- arquivo nao esta medindo o que diz medir.
--
-- O QUE ESPERAR: uma unica linha "CONEXOES: TUDO OK".
-- =====================================================

-- =====================================================
-- Teste das conexoes entre usuarios (010)
-- =====================================================
-- Responde o que o 010 sozinho nao prova:
--
--   1. CONSENTIMENTO. Quem pede nao aceita o proprio pedido -- nem por UPDATE,
--      nem gravando a linha ja 'accepted' de saida. Esta e a assercao central
--      do arquivo: conexao aceita e o que habilita puxar alguem para o rateio
--      de uma despesa, entao uma conexao que nasce aceita e uma pessoa
--      entrando na vida financeira de outra sem clicar em nada.
--   2. O par e unico NOS DOIS SENTIDOS: A->B e B->A nao coexistem.
--   3. O BLOQUEIO dura: quem foi recusado nao apaga a propria linha de bloqueio
--      para pedir de novo.
--   4. Um terceiro nao ve a conexao alheia, e os dois envolvidos veem.
--   5. O estado nao anda para tras: aceito nao volta a pendente.
--   6. Os NOMES das duas foreign keys existem -- eles sao contrato com os
--      embeds `profiles!user_connections_requester_id_fkey` que a tela e cinco
--      rotas ja usam. Com nome diferente a tabela existe e as consultas
--      continuam falhando.
--   7. `anon` nao tem privilegio nenhum na tabela.
--
-- Tem DOIS CONTROLES NEGATIVOS no fim: as regras 1 e 2 sao reintroduzidas
-- quebradas e o teste tem que ficar vermelho. Sem eles, uma policy que parasse
-- de valer deixaria este arquivo verde do mesmo jeito.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 009 -> 010:
--   psql "$DB_URL" -f database/tests/user_connections_test.sql
--
-- Qualquer FALHA lanca excecao e aborta.
-- =====================================================

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
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- Espera que um comando quebre. Sem isto, uma policy que parou de valer
-- deixaria o teste verde: o comando proibido passaria e ninguem contaria nada.
CREATE OR REPLACE FUNCTION pg_temp.expect_erro(label TEXT, sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ok: % (barrado: %)', label, left(SQLERRM, 70);
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o comando PASSOU e deveria ter sido barrado', label;
END $$;

-- Um UPDATE/DELETE barrado por RLS nao lanca erro: ele simplesmente nao
-- alcanca linha nenhuma. Sem esta funcao, "o bloqueio nao pode ser apagado
-- por quem foi bloqueado" seria testado com um DELETE que "passa" sem apagar
-- nada -- e passaria igual se a policy sumisse.
CREATE OR REPLACE FUNCTION pg_temp.expect_zero_linhas(label TEXT, sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  n INTEGER;
BEGIN
  EXECUTE sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FALHA: % -> alcancou % linha(s), deveria alcancar 0', label, n;
  END IF;
  RAISE NOTICE 'ok: % (0 linhas, como esperado)', label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_n_linhas(label TEXT, sql TEXT, want INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  n INTEGER;
BEGIN
  EXECUTE sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> want THEN
    RAISE EXCEPTION 'FALHA: % -> alcancou % linha(s), esperado %', label, n, want;
  END IF;
  RAISE NOTICE 'ok: % (% linha(s))', label, n;
END $$;

-- =====================================================
-- Fixture
-- =====================================================
--   A  quem pede
--   B  quem recebe
--   C  um terceiro, que nao pode ver nada dos dois
--   D  alguem que desligou allow_connections
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000c010', 'a@conn.local'),
  ('bbbbbbbb-0000-0000-0000-00000000c010', 'b@conn.local'),
  ('cccccccc-0000-0000-0000-00000000c010', 'c@conn.local'),
  ('dddddddd-0000-0000-0000-00000000c010', 'd@conn.local');

-- is_public TRUE nos quatro: e assim que eles se encontram na busca, e a
-- policy de INSERT precisa enxergar o perfil do alvo para conferir
-- allow_connections.
INSERT INTO public.profiles (id, full_name, nickname, is_public, allow_connections) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000c010', 'Helio',  'helio',  TRUE, TRUE),
  ('bbbbbbbb-0000-0000-0000-00000000c010', 'Ana',    'ana',    TRUE, TRUE),
  ('cccccccc-0000-0000-0000-00000000c010', 'Carlos', 'carlos', TRUE, TRUE),
  ('dddddddd-0000-0000-0000-00000000c010', 'Dora',   'dora',   TRUE, FALSE);

-- =====================================================
-- SECAO 1: os nomes das FKs sao contrato com a PostgREST
-- =====================================================
-- A tela faz `requester:profiles!user_connections_requester_id_fkey(...)`.
-- A PostgREST resolve o embed pelo NOME da constraint: com nome gerado
-- automaticamente a tabela existe, a tela continua quebrada, e o erro novo
-- ("could not find a relationship") nao se parece com o antigo.
DO $$ BEGIN PERFORM pg_temp.expect('FK user_connections_requester_id_fkey existe',
  (SELECT COUNT(*) FROM pg_constraint
    WHERE conname = 'user_connections_requester_id_fkey'
      AND conrelid = 'public.user_connections'::regclass
      AND confrelid = 'public.profiles'::regclass), 1); END $$;

DO $$ BEGIN PERFORM pg_temp.expect('FK user_connections_requested_id_fkey existe',
  (SELECT COUNT(*) FROM pg_constraint
    WHERE conname = 'user_connections_requested_id_fkey'
      AND conrelid = 'public.user_connections'::regclass
      AND confrelid = 'public.profiles'::regclass), 1); END $$;

-- =====================================================
-- SECAO 2: os CHECKs (valem para qualquer role, inclusive service_role)
-- =====================================================
DO $$ BEGIN PERFORM pg_temp.expect_erro('conectar-se consigo mesmo e barrado', $sql$
  INSERT INTO public.user_connections (requester_id, requested_id)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000c010', 'aaaaaaaa-0000-0000-0000-00000000c010')
$sql$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_erro('status fora do dominio e barrado', $sql$
  INSERT INTO public.user_connections (requester_id, requested_id, status)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000c010', 'bbbbbbbb-0000-0000-0000-00000000c010', 'amigos')
$sql$); END $$;

-- responded_at e o carimbo da resposta: 'accepted' sem carimbo e uma conexao
-- aceita sem data, e so olhando linha a linha no banco alguem perceberia.
DO $$ BEGIN PERFORM pg_temp.expect_erro('accepted sem responded_at e barrado', $sql$
  INSERT INTO public.user_connections (requester_id, requested_id, status)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000c010', 'bbbbbbbb-0000-0000-0000-00000000c010', 'accepted')
$sql$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_erro('pending COM responded_at e barrado', $sql$
  INSERT INTO public.user_connections (requester_id, requested_id, status, responded_at)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000c010', 'bbbbbbbb-0000-0000-0000-00000000c010', 'pending', now())
$sql$); END $$;

-- =====================================================
-- SECAO 3: A pede para B  (o caminho feliz, sob RLS)
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000c010';

INSERT INTO public.user_connections (id, requester_id, requested_id, message)
VALUES ('e0000000-0000-0000-0000-0000000000a1',
        'aaaaaaaa-0000-0000-0000-00000000c010',
        'bbbbbbbb-0000-0000-0000-00000000c010',
        'sou eu, do grupo da viagem');

DO $$ BEGIN PERFORM pg_temp.expect_text('o pedido nasce pending',
  (SELECT status FROM public.user_connections WHERE id = 'e0000000-0000-0000-0000-0000000000a1'),
  'pending'); END $$;

-- ---------------------------------------------------------------------------
-- A ASSERCAO CENTRAL DO ARQUIVO
-- ---------------------------------------------------------------------------
-- Sem o `status = 'pending'` no WITH CHECK da policy de INSERT, qualquer
-- usuario logado gravaria (eu, a vitima, 'accepted') e passaria a constar como
-- conexao aceita dela. Conexao aceita e o que habilita puxar alguem para o
-- rateio de uma despesa: a vitima veria, na propria lista, uma pessoa com quem
-- ela nunca concordou em dividir nada.
DO $$ BEGIN PERFORM pg_temp.expect_erro('A NAO grava uma conexao ja aceita', $sql$
  INSERT INTO public.user_connections (requester_id, requested_id, status, responded_at)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000c010', 'cccccccc-0000-0000-0000-00000000c010',
          'accepted', now())
$sql$); END $$;

-- E nem em nome de outra pessoa.
DO $$ BEGIN PERFORM pg_temp.expect_erro('A NAO pede em nome do C', $sql$
  INSERT INTO public.user_connections (requester_id, requested_id)
  VALUES ('cccccccc-0000-0000-0000-00000000c010', 'bbbbbbbb-0000-0000-0000-00000000c010')
$sql$); END $$;

-- Quem desligou allow_connections nao recebe pedido. A rota ja confere e
-- devolve mensagem clara; a policy e a rede embaixo, para o caminho que nao
-- passa pela rota (a tela grava direto via supabase-js).
DO $$ BEGIN PERFORM pg_temp.expect_erro('quem desligou allow_connections nao recebe pedido', $sql$
  INSERT INTO public.user_connections (requester_id, requested_id)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000c010', 'dddddddd-0000-0000-0000-00000000c010')
$sql$); END $$;

-- O par invertido: B pedir para A depois de A ter pedido para B criaria DOIS
-- pendentes. Cada um veria um pedido do outro, aceitar um deixaria o outro
-- pendente para sempre, e a tela mostraria "1 pendente" em vermelho sem nada
-- para resolver.
RESET ROLE;
RESET request.jwt.claim.sub;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-00000000c010';

DO $$ BEGIN PERFORM pg_temp.expect_erro('o par invertido bate na UNIQUE', $sql$
  INSERT INTO public.user_connections (requester_id, requested_id)
  VALUES ('bbbbbbbb-0000-0000-0000-00000000c010', 'aaaaaaaa-0000-0000-0000-00000000c010')
$sql$); END $$;

-- =====================================================
-- SECAO 4: so B aceita, e A nao
-- =====================================================
-- B (autenticado acima) ve o pedido.
DO $$ BEGIN PERFORM pg_temp.expect('B ve o pedido que recebeu',
  (SELECT COUNT(*) FROM public.user_connections
    WHERE requested_id = 'bbbbbbbb-0000-0000-0000-00000000c010' AND status = 'pending'), 1); END $$;

RESET ROLE;
RESET request.jwt.claim.sub;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000c010';

-- A ve o proprio pedido (o SELECT cobre os dois lados)...
DO $$ BEGIN PERFORM pg_temp.expect('A ve o pedido que enviou',
  (SELECT COUNT(*) FROM public.user_connections
    WHERE id = 'e0000000-0000-0000-0000-0000000000a1'), 1); END $$;

-- ...mas nao o aceita. Um UPDATE barrado por RLS nao da erro: ele nao alcanca
-- linha nenhuma. Se esta assercao fosse so "o status continua pending", ela
-- passaria tambem num banco onde o UPDATE alcancou a linha e outra coisa
-- impediu a gravacao -- por isso a contagem de linhas.
DO $$ BEGIN PERFORM pg_temp.expect_zero_linhas('A NAO aceita o proprio pedido', $sql$
  UPDATE public.user_connections
     SET status = 'accepted', responded_at = now()
   WHERE id = 'e0000000-0000-0000-0000-0000000000a1'
$sql$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_text('continua pending depois da tentativa de A',
  (SELECT status FROM public.user_connections WHERE id = 'e0000000-0000-0000-0000-0000000000a1'),
  'pending'); END $$;

-- Agora B aceita de verdade.
RESET ROLE;
RESET request.jwt.claim.sub;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-00000000c010';

DO $$ BEGIN PERFORM pg_temp.expect_n_linhas('B aceita', $sql$
  UPDATE public.user_connections
     SET status = 'accepted', responded_at = now()
   WHERE id = 'e0000000-0000-0000-0000-0000000000a1'
$sql$, 1); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_text('a conexao ficou accepted',
  (SELECT status FROM public.user_connections WHERE id = 'e0000000-0000-0000-0000-0000000000a1'),
  'accepted'); END $$;

-- O estado nao anda para tras: o USING da policy exige status = 'pending'.
-- Reabrir uma conexao ja respondida deixaria a tela do outro lado com um
-- pedido que ele ja tinha resolvido.
DO $$ BEGIN PERFORM pg_temp.expect_zero_linhas('accepted nao volta para pending', $sql$
  UPDATE public.user_connections
     SET status = 'pending', responded_at = NULL
   WHERE id = 'e0000000-0000-0000-0000-0000000000a1'
$sql$); END $$;

-- =====================================================
-- SECAO 5: um terceiro nao ve nada disso
-- =====================================================
RESET ROLE;
RESET request.jwt.claim.sub;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'cccccccc-0000-0000-0000-00000000c010';

DO $$ BEGIN PERFORM pg_temp.expect('C nao ve a conexao de A e B',
  (SELECT COUNT(*) FROM public.user_connections), 0); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_zero_linhas('C nao apaga a conexao de A e B', $sql$
  DELETE FROM public.user_connections WHERE id = 'e0000000-0000-0000-0000-0000000000a1'
$sql$); END $$;

-- =====================================================
-- SECAO 6: o bloqueio dura
-- =====================================================
-- C pede para B, e B recusa. Recusar grava 'blocked' -- e o ponto e que o
-- bloqueio nao pode ser desfeito por quem foi bloqueado.
INSERT INTO public.user_connections (id, requester_id, requested_id)
VALUES ('e0000000-0000-0000-0000-0000000000c1',
        'cccccccc-0000-0000-0000-00000000c010',
        'bbbbbbbb-0000-0000-0000-00000000c010');

RESET ROLE;
RESET request.jwt.claim.sub;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-00000000c010';

DO $$ BEGIN PERFORM pg_temp.expect_n_linhas('B recusa o pedido do C', $sql$
  UPDATE public.user_connections
     SET status = 'blocked', responded_at = now()
   WHERE id = 'e0000000-0000-0000-0000-0000000000c1'
$sql$, 1); END $$;

RESET ROLE;
RESET request.jwt.claim.sub;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'cccccccc-0000-0000-0000-00000000c010';

-- Com um DELETE simetrico, C apagaria a linha de bloqueio e mandaria o pedido
-- de novo -- e de novo. O bloqueio apareceria na tela de B e nao valeria nada.
DO $$ BEGIN PERFORM pg_temp.expect_zero_linhas('C NAO apaga o proprio bloqueio', $sql$
  DELETE FROM public.user_connections WHERE id = 'e0000000-0000-0000-0000-0000000000c1'
$sql$); END $$;

-- E, como a linha continua la, o pedido novo bate na UNIQUE do par.
DO $$ BEGIN PERFORM pg_temp.expect_erro('C nao consegue pedir de novo', $sql$
  INSERT INTO public.user_connections (requester_id, requested_id)
  VALUES ('cccccccc-0000-0000-0000-00000000c010', 'bbbbbbbb-0000-0000-0000-00000000c010')
$sql$); END $$;

-- Quem bloqueou desbloqueia.
RESET ROLE;
RESET request.jwt.claim.sub;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-00000000c010';

DO $$ BEGIN PERFORM pg_temp.expect_n_linhas('B desbloqueia', $sql$
  DELETE FROM public.user_connections WHERE id = 'e0000000-0000-0000-0000-0000000000c1'
$sql$, 1); END $$;

-- =====================================================
-- SECAO 7: desistir do proprio pedido, e desfazer a conexao
-- =====================================================
RESET ROLE;
RESET request.jwt.claim.sub;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'cccccccc-0000-0000-0000-00000000c010';

-- D desligou allow_connections: o pedido nao entra. Um INSERT barrado por RLS
-- LANCA erro, nao passa em silencio -- por isso expect_erro e nao uma contagem
-- de linhas depois.
DO $$ BEGIN PERFORM pg_temp.expect_erro('C tambem nao alcanca D', $sql$
  INSERT INTO public.user_connections (id, requester_id, requested_id)
  VALUES ('e0000000-0000-0000-0000-0000000000c2',
          'cccccccc-0000-0000-0000-00000000c010',
          'dddddddd-0000-0000-0000-00000000c010')
$sql$); END $$;

INSERT INTO public.user_connections (id, requester_id, requested_id)
VALUES ('e0000000-0000-0000-0000-0000000000c3',
        'cccccccc-0000-0000-0000-00000000c010',
        'aaaaaaaa-0000-0000-0000-00000000c010');

DO $$ BEGIN PERFORM pg_temp.expect_n_linhas('C desiste do proprio pedido', $sql$
  DELETE FROM public.user_connections WHERE id = 'e0000000-0000-0000-0000-0000000000c3'
$sql$, 1); END $$;

-- A conexao aceita entre A e B: qualquer um dos dois desfaz. Quem desfaz aqui
-- e o A, que foi quem PEDIU -- o lado que nao pode mexer no status.
RESET ROLE;
RESET request.jwt.claim.sub;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000c010';

DO $$ BEGIN PERFORM pg_temp.expect_n_linhas('A desfaz a conexao aceita', $sql$
  DELETE FROM public.user_connections WHERE id = 'e0000000-0000-0000-0000-0000000000a1'
$sql$, 1); END $$;

RESET ROLE;
RESET request.jwt.claim.sub;

-- =====================================================
-- SECAO 8: anon
-- =====================================================
-- A chave anon vai embutida no bundle JS publico. Qualquer privilegio que ela
-- tenha nesta tabela e a lista de quem se conecta com quem, aberta na
-- internet.
DO $$ BEGIN PERFORM pg_temp.expect('anon nao tem privilegio em user_connections',
  (SELECT COUNT(*) FROM information_schema.role_table_grants
    WHERE grantee = 'anon' AND table_schema = 'public'
      AND table_name = 'user_connections'), 0); END $$;

-- =====================================================
-- SECAO 9: o perfil sai, a conexao sai junto
-- =====================================================
INSERT INTO public.user_connections (id, requester_id, requested_id)
VALUES ('e0000000-0000-0000-0000-0000000000d1',
        'aaaaaaaa-0000-0000-0000-00000000c010',
        'bbbbbbbb-0000-0000-0000-00000000c010');

DELETE FROM auth.users WHERE id = 'bbbbbbbb-0000-0000-0000-00000000c010';

DO $$ BEGIN PERFORM pg_temp.expect('apagar a conta leva a conexao junto',
  (SELECT COUNT(*) FROM public.user_connections
    WHERE id = 'e0000000-0000-0000-0000-0000000000d1'), 0); END $$;

-- =====================================================
-- SECAO 10: CONTROLES NEGATIVOS
-- =====================================================
-- As duas regras que mais importam sao reintroduzidas QUEBRADAS aqui. Se
-- qualquer uma das duas secoes abaixo NAO ficar vermelha, este arquivo inteiro
-- nao esta provando o que diz provar.

-- ---- controle 1: policy de INSERT sem o `status = 'pending'` ----
DROP POLICY user_connections_insert ON public.user_connections;
CREATE POLICY user_connections_insert ON public.user_connections
  FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid() AND requested_id <> auth.uid());

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000c010';

INSERT INTO public.user_connections (id, requester_id, requested_id, status, responded_at)
VALUES ('e0000000-0000-0000-0000-0000000000f1',
        'aaaaaaaa-0000-0000-0000-00000000c010',
        'cccccccc-0000-0000-0000-00000000c010',
        'accepted', now());

RESET ROLE;
RESET request.jwt.claim.sub;

DO $$
DECLARE
  n BIGINT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.user_connections
   WHERE id = 'e0000000-0000-0000-0000-0000000000f1';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FALHA no controle negativo 1: a policy quebrada deveria ter DEIXADO passar a conexao auto-aceita, e nao deixou (% linha(s)). O teste nao esta medindo o que diz medir.', n;
  END IF;
  RAISE NOTICE 'ok: controle negativo 1 -- sem o status=pending no WITH CHECK, a conexao auto-aceita ENTRA (e por isso a regra existe)';
END $$;

DELETE FROM public.user_connections WHERE id = 'e0000000-0000-0000-0000-0000000000f1';

-- ---- controle 2: sem o indice unico do par nao ordenado ----
DROP INDEX public.uniq_user_connections_pair;

INSERT INTO public.user_connections (id, requester_id, requested_id) VALUES
  ('e0000000-0000-0000-0000-0000000000f2',
   'aaaaaaaa-0000-0000-0000-00000000c010', 'cccccccc-0000-0000-0000-00000000c010'),
  ('e0000000-0000-0000-0000-0000000000f3',
   'cccccccc-0000-0000-0000-00000000c010', 'aaaaaaaa-0000-0000-0000-00000000c010');

DO $$
DECLARE
  n BIGINT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.user_connections
   WHERE id IN ('e0000000-0000-0000-0000-0000000000f2', 'e0000000-0000-0000-0000-0000000000f3');
  IF n <> 2 THEN
    RAISE EXCEPTION 'FALHA no controle negativo 2: sem o indice, os dois sentidos deveriam ter entrado (% linha(s)).', n;
  END IF;
  RAISE NOTICE 'ok: controle negativo 2 -- sem o indice do par nao ordenado, A->C e C->A coexistem como dois pendentes';
END $$;

-- =====================================================
ROLLBACK;

-- Se esta linha aparecer, nenhuma assercao acima abortou o lote: o teste passou.
-- Ela roda DEPOIS do ROLLBACK, ou seja, fora da transacao que foi desfeita.
SELECT 'CONEXOES: TUDO OK -- consentimento, par unico nos dois sentidos, bloqueio duravel e isolamento conferidos' AS resultado;
