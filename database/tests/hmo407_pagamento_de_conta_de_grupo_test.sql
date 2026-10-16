-- =====================================================
-- HMO-407/410 -- o "pago" de uma conta de grupo e da PESSOA (055)
-- =====================================================
-- Roda no db-verify, contra o banco que as migrations constroem do zero, na
-- POSICAO dele da cadeia: depois da 055.
--
-- O QUE A 055 ENTREGA
-- -------------------
-- `scheduled_transactions` tem UMA coluna `status`, e ela e do DONO da linha.
-- Quando o Helio paga a conta do grupo Casa, ela sai do «a pagar» da Lais e da
-- Ana, que nao pagaram nada. A 055 cria `group_bill_payments` (estado por
-- pessoa) e duas colunas novas no fim de `scheduled_transactions_effective`:
-- `my_status` e `my_effective_status`.
--
-- O NUMERO DA ISSUE NAO E DINHEIRO
-- --------------------------------
-- Nenhuma soma muda com esta migration -- o rateio (`group_share_entries`) ja
-- estava certo. O numero a prender e um ESTADO: com a conta do grupo em
-- `status = 'paid'` (o dono pagou), o `my_status` da OUTRA pessoa continua
-- `pending`. E a secao 1.
--
-- POR QUE NAO BASTA MEDIR ESSE ESTADO
-- -----------------------------------
--   SECAO 1  O CASO DA ISSUE, pelos quatro lados da mesma conta: o dono ve
--            `paid`, quem nao tem linha ve `pending`, quem avisou ve
--            `reported`, quem foi confirmado ve `paid`. E a CONTAGEM de linhas
--            da view, que e a guarda contra o LEFT JOIN novo multiplicar a
--            agenda -- a conta do fixture tem DUAS linhas de pagamento de
--            proposito, para que essa contagem meca algo.
--
--   SECAO 2  O QUE NAO PODE MUDAR, e e a secao que autoriza as oito leituras do
--            app a trocarem `status` por `my_status`: para toda linha que e
--            MINHA, `my_status = status::text` e
--            `my_effective_status = effective_status::text`. Sem esta secao, uma
--            coluna que devolvesse sempre 'pending' passaria a secao 1 inteira
--            (a conta do dono la esta `paid`, mas a assercao que importa e a da
--            outra pessoa, e essa e justamente 'pending').
--
--   SECAO 3  `reported` NAO vira `overdue` depois do vencimento, e `pending`
--            vira. As duas afirmacoes saem da MESMA conta, com o MESMO
--            vencimento no passado, lida por duas pessoas: e o unico desenho em
--            que "quem avisou nao esta em atraso" se distingue de "o CASE do
--            overdue foi esquecido".
--
--   SECAO 4  A ESCRITA DO MEMBRO sob RLS: ele consegue `pending -> reported` e
--            nao consegue se dar por pago. ATENCAO ao que esta secao NAO pode
--            usar: UPDATE barrado pelo `USING` da policy nao da erro, afeta
--            ZERO linhas e volta com sucesso. Uma assercao de "recusou com
--            42501" ali ficaria verde por nunca ter sido executada. Por isso
--            existe `expect_nenhuma_linha`.
--
--   SECAO 5  A TRIGGER, isolada. A policy de UPDATE e a trigger sao travas
--            DIFERENTES, e esta secao prova a segunda sozinha -- no desenho da
--            secao 4.1 do teste da 053: o role volta a ser o dono (RLS fora do
--            caminho) e o claim CONTINUA sendo o do membro. O caminho que ela
--            mede e o repontamento, e ele passa pelas DUAS metades da policy:
--            o `USING` aprova pela metade do membro (a linha antiga e minha e
--            esta `pending`) e o `WITH CHECK` pela metade do dono (depois do
--            repontamento eu sou o dono da conta apontada). Sem a trigger, o
--            membro grava `status = 'paid'` com `confirmed_at` forjado.
--
--   SECAO 6  QUEM NAO LE: o nao-membro nao ve a linha, o ex-membro
--            (`status = 'removed'`) nao cria linha -- e e ele que mede o
--            `is_group_member` da policy de INSERT, porque `is_group_member`
--            exige `active` e o nao-membro seria recusado mesmo sem isso --, e
--            um membro ATIVO nao ve a linha de outro membro (a policy de SELECT
--            de proposito nao usa `is_group_member`).
--
--   SECAO 7  O CATALOGO: `security_invoker` da view (neste banco o dono e
--            superusuario e bypassa RLS, entao um teste so de comportamento
--            ficaria VERDE com a view furada), a UNIQUE que impede o join
--            multiplicar, a RLS ligada, `anon` sem alcance, e a LISTA ORDENADA
--            das 22 colunas da view -- que e o que prende as duas novas no FIM
--            e as vinte antigas na posicao delas.
--
--   SECAO 8  O CONTROLE NEGATIVO. Reproduz o join SEM o
--            `AND p.user_id = auth.uid()` sobre a mesma fixture e EXIGE o
--            numero errado: a linha dobra e o `pending` da outra pessoa
--            DESAPARECE. Ele falha no dia em que a fixture deixar de conter o
--            caso -- e nesse dia as secoes 1 e 2 param de medir sem avisar.
--
--   SECAO 9  O CHECK dos carimbos e o CASCADE da FK.
--
-- O QUE A VARREDURA DE MUTANTES MEDIU, E O QUE ELA MUDOU NESTE ARQUIVO
-- --------------------------------------------------------------------
-- 19 mutantes da 055 foram aplicados localmente (banco novo por mutante, a
-- partir da cadeia 001 -> ... -> 054), com controle positivo na arvore intacta.
-- 16 morreram. Tres assercoes deste arquivo existem SO porque a primeira volta
-- da varredura mostrou que sem elas o defeito passava:
--
--   * «o repontamento mesmo com a transicao legal» -- sem ela,
--     `pin-sem-scheduled-transaction-id` sobrevivia: a outra assercao de
--     repontamento leva `status = 'paid'`, e a conferencia de TRANSICAO a
--     recusa antes de o pin ser consultado;
--   * «o membro RETRODATANDO um aviso ja dado» -- sem ela,
--     `transicao-do-membro-sem-conferencia` sobrevivia a suite inteira, pelo
--     motivo inverso: toda outra tentativa do membro mexe num campo que o pin
--     ja protege;
--   * «o membro NAO cria a PROPRIA linha ja paga» -- a versao anterior usava o
--     `user_id` de outra pessoa, entao a recusa vinha do `user_id = auth.uid()`
--     e `insert-aceita-paid` sobrevivia.
--
-- TRES MUTANTES SOBREVIVEM, e os tres estao CERTOS -- sao no-ops de defesa em
-- profundidade, nao buracos. Estao anotados aqui para que ninguem os "conserte"
-- achando que sao cobertura faltando:
--
--   * `insert-sem-is-group-member`: o `EXISTS` da policy de INSERT consulta
--     `scheduled_transactions` SOB A RLS DO INVOCADOR, e a policy de SELECT
--     daquela tabela (`005:310-316`) ja exige `is_group_member`. O
--     `is_group_member` explicito da 055 e redundante HOJE; ele fica porque
--     afrouxar a policy de leitura de `scheduled_transactions` amanha nao pode
--     abrir a escrita aqui;
--   * `update-with-check-sem-reported`: a metade do membro no `WITH CHECK` e
--     coberta pela conferencia de transicao da trigger mais o CHECK dos
--     carimbos. Ela fica porque a policy e a primeira trava e a trigger e a
--     rede;
--   * `sem-revoke-de-anon-na-tabela`: o `anon` nunca teve o GRANT -- o
--     `GRANT ... ON ALL TABLES` do 002 e uma fotografia tirada antes desta
--     tabela existir. O REVOKE da 055 e um no-op medido, e fica por simetria
--     com a 053.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 055:
--   psql "$DB_URL" -f database/tests/hmo407_pagamento_de_conta_de_grupo_test.sql
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
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- O que ERRA, com o SQLSTATE no contrato: 42501 e a policy ou a trigger, 23514
-- e o CHECK dos carimbos, 23505 e a UNIQUE. A diferenca entre eles e a propria
-- decisao de desenho.
CREATE OR REPLACE FUNCTION pg_temp.expect_recusa(label TEXT, sql TEXT, sqlstate_esperado TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> sqlstate_esperado THEN
      RAISE EXCEPTION 'FALHA: % -> recusou com % e nao com % (%)', label, SQLSTATE, sqlstate_esperado, SQLERRM;
    END IF;
    RAISE NOTICE 'ok: % (recusado com %)', label, sqlstate_esperado;
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o banco ACEITOU, e devia recusar com %', label, sqlstate_esperado;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_aceita(label TEXT, sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RAISE NOTICE 'ok: % (aceito)', label;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FALHA: % -> o banco RECUSOU (% %), e devia aceitar', label, SQLSTATE, SQLERRM;
END $$;

-- A ARMADILHA QUE ESTE HELPER EXISTE PARA EVITAR
-- ----------------------------------------------
-- `UPDATE` cujo `USING` da policy nao casa com nenhuma linha NAO da erro: ele
-- afeta zero linhas e volta com sucesso. Escrever essa recusa como
-- `expect_recusa(..., '42501')` reprovaria o teste no caminho certo, e trocar
-- para `expect_aceita` o deixaria VERDE tendo medido nada. O que prova a
-- recusa aqui e `ROW_COUNT = 0` mais a releitura do estado.
CREATE OR REPLACE FUNCTION pg_temp.expect_nenhuma_linha(label TEXT, sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FALHA: % -> a RLS deixou passar % linha(s), e devia filtrar todas', label, n;
  END IF;
  RAISE NOTICE 'ok: % (a RLS filtrou: 0 linhas)', label;
END $$;

-- =====================================================
-- Fixture
-- =====================================================
--   D = o DONO das contas previstas (admin do grupo)
--   E = membro ATIVO SEM linha de pagamento  -> o caso do COALESCE, e o numero
--                                               da issue
--   A = membro ATIVO com linha `reported`    -> avisou que pagou
--   B = membro ATIVO com linha `paid`        -> o dono confirmou
--   C = NAO-membro
--   F = EX-membro (`status = 'removed'`)     -> o controle do `active` dentro
--                                               do `is_group_member`
--
-- E e A e B juntos nao sao luxo: a conta CG1 precisa de DUAS linhas de pagamento
-- (A e B) para que a contagem da secao 1 e o controle negativo da secao 8 medam
-- a multiplicacao do LEFT JOIN, e precisa de UMA pessoa SEM linha (E) para que o
-- COALESCE seja exercitado. Com dois usuarios so, um dos dois casos fica fora.
INSERT INTO auth.users (id, email) VALUES
  ('40700000-0000-0000-0000-00000000000d', 'd407@ci.local'),
  ('40700000-0000-0000-0000-00000000000e', 'e407@ci.local'),
  ('40700000-0000-0000-0000-00000000000a', 'a407@ci.local'),
  ('40700000-0000-0000-0000-00000000000b', 'b407@ci.local'),
  ('40700000-0000-0000-0000-00000000000c', 'c407@ci.local'),
  ('40700000-0000-0000-0000-00000000000f', 'f407@ci.local');

INSERT INTO public.profiles (id, full_name) VALUES
  ('40700000-0000-0000-0000-00000000000d', 'D, a dona das contas'),
  ('40700000-0000-0000-0000-00000000000e', 'E, membro sem linha'),
  ('40700000-0000-0000-0000-00000000000a', 'A, membro que avisou'),
  ('40700000-0000-0000-0000-00000000000b', 'B, membro confirmado'),
  ('40700000-0000-0000-0000-00000000000c', 'C, nao-membro'),
  ('40700000-0000-0000-0000-00000000000f', 'F, ex-membro');

INSERT INTO public.expense_groups (id, name, group_code, created_by) VALUES
  ('40700000-0000-0000-0000-0000000000f1', 'Casa (HMO-407)', 'HMO407', '40700000-0000-0000-0000-00000000000d');

-- O D **nao** e inserido aqui: `add_group_creator_trigger` (001) ja o pos como
-- `admin`/`active` no INSERT do grupo acima, e repetir a linha estoura a
-- `unique_user_per_group`.
--
-- F entra como `removed`, e nao "sem linha": sem linha alguma, a policy de
-- INSERT passaria pelo `EXISTS` mesmo se o `status = 'active'` de dentro do
-- `is_group_member` tivesse sido esquecido. E o `removed` que distingue "nao e
-- do grupo" de "era do grupo e saiu".
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('40700000-0000-0000-0000-0000000000f1', '40700000-0000-0000-0000-00000000000e', 'member', 'active'),
  ('40700000-0000-0000-0000-0000000000f1', '40700000-0000-0000-0000-00000000000a', 'member', 'active'),
  ('40700000-0000-0000-0000-0000000000f1', '40700000-0000-0000-0000-00000000000b', 'member', 'active'),
  ('40700000-0000-0000-0000-0000000000f1', '40700000-0000-0000-0000-00000000000f', 'member', 'removed');

-- E o controle positivo da observacao acima: o trigger realmente pos o dono no
-- grupo. Se ele deixar de o fazer, o D para de ser membro e varias assercoes
-- abaixo mudariam de significado sem avisar.
DO $$ BEGIN PERFORM pg_temp.expect('o trigger do 001 pos o dono no grupo como admin ativo',
  (SELECT count(*) FROM public.group_members
    WHERE group_id = '40700000-0000-0000-0000-0000000000f1'
      AND user_id  = '40700000-0000-0000-0000-00000000000d'
      AND role = 'admin' AND status = 'active'), 1); END $$;

-- A categoria vem das SEMEADAS pela cadeia: `transaction_categories.service_id`
-- e NOT NULL e nao e desta issue. `service_id` vem junto porque
-- `financial_transactions.service_id` e NOT NULL e a conta PAGA abaixo precisa
-- de uma transacao de verdade (o `scheduled_transactions_paid_check` do 005
-- exige `paid_date` E `transaction_id` quando o status e `paid`).
CREATE TEMP TABLE cat AS
  SELECT id, service_id FROM public.transaction_categories WHERE is_expense LIMIT 1;

-- A transacao real da baixa do dono. `group_id` NULO de proposito: com
-- `group_id` o trigger do 001/042 rateia a despesa e cria `group_share_entries`,
-- e este teste nao e sobre rateio -- a fixture ficaria com linhas que ninguem
-- afirma.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, description, amount, transaction_date, transaction_type)
SELECT '40700000-0000-0000-0000-00000000aa01', '40700000-0000-0000-0000-00000000000d',
       cat.service_id, cat.id, 'Luz da Casa paga pelo D', -300.00, CURRENT_DATE, 'expense'
FROM cat;

-- As contas previstas. Todas do D, que e quem as cadastra -- e esse e o ponto:
-- uma conta do grupo e UMA linha, de UM dono.
--
--   CG1  grupo, `paid`      -> O CASO DA ISSUE. Vencimento no futuro para que a
--                             secao 1 meca o estado e nao o atraso.
--   CG2  grupo, `pending`, VENCIDA -> a secao 3 (reported nao e overdue)
--   CG3  grupo, `pending`   -> a bancada de ESCRITA das secoes 4, 5 e 9
--   P1   pessoal, `pending`         -> a secao 2
--   P2   pessoal, `pending`, VENCIDA-> a secao 2 com overdue
--   P3   pessoal, `skipped`         -> a secao 2 com estado que nao e pending
--   PE1  pessoal DO E               -> o destino do repontamento da secao 5
INSERT INTO public.scheduled_transactions
  (id, user_id, group_id, category_id, description, amount, due_date, status,
   transaction_type, paid_date, transaction_id)
SELECT v.id, v.dono, v.grupo, cat.id, v.descricao, v.valor, v.venc, v.st,
       'expense', v.pago_em, v.tx
FROM cat, (VALUES
  ('40700000-0000-0000-0000-0000000000c1'::uuid, '40700000-0000-0000-0000-00000000000d'::uuid,
   '40700000-0000-0000-0000-0000000000f1'::uuid, 'Luz da Casa', 300::numeric,
   CURRENT_DATE + 10, 'paid'::public.scheduled_status, CURRENT_DATE,
   '40700000-0000-0000-0000-00000000aa01'::uuid),
  ('40700000-0000-0000-0000-0000000000c2'::uuid, '40700000-0000-0000-0000-00000000000d'::uuid,
   '40700000-0000-0000-0000-0000000000f1'::uuid, 'Internet da Casa (vencida)', 120::numeric,
   CURRENT_DATE - 5, 'pending', NULL, NULL),
  ('40700000-0000-0000-0000-0000000000c3'::uuid, '40700000-0000-0000-0000-00000000000d'::uuid,
   '40700000-0000-0000-0000-0000000000f1'::uuid, 'Agua da Casa', 90::numeric,
   CURRENT_DATE + 12, 'pending', NULL, NULL),
  ('40700000-0000-0000-0000-0000000000d1'::uuid, '40700000-0000-0000-0000-00000000000d'::uuid,
   NULL, 'Academia (pessoal)', 150::numeric,
   CURRENT_DATE + 8, 'pending', NULL, NULL),
  ('40700000-0000-0000-0000-0000000000d2'::uuid, '40700000-0000-0000-0000-00000000000d'::uuid,
   NULL, 'IPTU (pessoal, vencido)', 400::numeric,
   CURRENT_DATE - 3, 'pending', NULL, NULL),
  ('40700000-0000-0000-0000-0000000000d3'::uuid, '40700000-0000-0000-0000-00000000000d'::uuid,
   NULL, 'Streaming (pessoal, pulado)', 40::numeric,
   CURRENT_DATE + 4, 'skipped', NULL, NULL),
  ('40700000-0000-0000-0000-0000000000e1'::uuid, '40700000-0000-0000-0000-00000000000e'::uuid,
   NULL, 'Celular do E (pessoal)', 60::numeric,
   CURRENT_DATE + 6, 'pending', NULL, NULL)
) AS v(id, dono, grupo, descricao, valor, venc, st, pago_em, tx);

-- As DUAS linhas de pagamento de CG1. Semeadas aqui (sem RLS no caminho) porque
-- o que a secao 1 mede e a LEITURA de cada estado, nao a transicao -- a
-- transicao tem as secoes 4 e 5.
--
-- E o E NAO ganha linha: e ele o numero da issue.
INSERT INTO public.group_bill_payments
  (scheduled_transaction_id, user_id, status, reported_at, confirmed_at) VALUES
  ('40700000-0000-0000-0000-0000000000c1', '40700000-0000-0000-0000-00000000000a',
   'reported', now(), NULL),
  ('40700000-0000-0000-0000-0000000000c1', '40700000-0000-0000-0000-00000000000b',
   'paid', now(), now());

-- E avisou que pagou a INTERNET vencida (CG2), para a secao 3.
INSERT INTO public.group_bill_payments
  (scheduled_transaction_id, user_id, status, reported_at) VALUES
  ('40700000-0000-0000-0000-0000000000c2', '40700000-0000-0000-0000-00000000000e',
   'reported', now());

-- =====================================================
-- SECAO 1: O CASO DA ISSUE
-- =====================================================
SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------------------------
-- E: membro ativo, nenhuma linha de pagamento. O NUMERO DA ISSUE.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000e';

-- A coluna VELHA, primeiro: a conta ESTA paga. Sem esta assercao, o `pending`
-- da linha seguinte nao distingue "a 055 funciona" de "a fixture nao tem conta
-- paga nenhuma".
DO $$ BEGIN PERFORM pg_temp.expect_text('ANTES: o `status` da conta do grupo e paid (o dono pagou)',
  (SELECT status::text FROM public.scheduled_transactions_effective
    WHERE id = '40700000-0000-0000-0000-0000000000c1'), 'paid'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_text('O NUMERO: o dono pagou e o my_status do E continua pending',
  (SELECT my_status FROM public.scheduled_transactions_effective
    WHERE id = '40700000-0000-0000-0000-0000000000c1'), 'pending'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_text('e o my_effective_status tambem (CG1 nao venceu)',
  (SELECT my_effective_status FROM public.scheduled_transactions_effective
    WHERE id = '40700000-0000-0000-0000-0000000000c1'), 'pending'); END $$;

-- A CONTAGEM, que e a guarda do LEFT JOIN novo. CG1 tem DUAS linhas de
-- pagamento; sem o `AND p.user_id = auth.uid()` ela apareceria duas vezes.
-- O E ve: CG1, CG2, CG3 (do grupo, pela policy do 005) e PE1 (a dele).
DO $$ BEGIN PERFORM pg_temp.expect('o E ve 4 linhas na agenda, e nao 5 (o join nao multiplica)',
  (SELECT count(*) FROM public.scheduled_transactions_effective), 4); END $$;

-- ---------------------------------------------------------------------------
-- A: avisou que pagou.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000a';
DO $$ BEGIN PERFORM pg_temp.expect_text('o A avisou: my_status = reported',
  (SELECT my_status FROM public.scheduled_transactions_effective
    WHERE id = '40700000-0000-0000-0000-0000000000c1'), 'reported'); END $$;
-- O A ve as 3 do grupo e nenhuma pessoal (ele nao tem conta propria na fixture).
-- Ele TEM linha de pagamento em CG1, e e por isso que a contagem dele mede o
-- outro lado da mesma guarda: se o join nao filtrasse `auth.uid()`, a dele e a
-- do B apareceriam as duas.
DO $$ BEGIN PERFORM pg_temp.expect('o A ve 3 linhas, e nao 4 (a linha DELE nao duplica a conta)',
  (SELECT count(*) FROM public.scheduled_transactions_effective), 3); END $$;

-- ---------------------------------------------------------------------------
-- B: o dono confirmou.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000b';
DO $$ BEGIN PERFORM pg_temp.expect_text('o B foi confirmado: my_status = paid',
  (SELECT my_status FROM public.scheduled_transactions_effective
    WHERE id = '40700000-0000-0000-0000-0000000000c1'), 'paid'); END $$;

-- ---------------------------------------------------------------------------
-- D: o dono. Ele ve o status DELE, que e o da linha.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000d';
DO $$ BEGIN PERFORM pg_temp.expect_text('o dono ve o proprio status: my_status = paid',
  (SELECT my_status FROM public.scheduled_transactions_effective
    WHERE id = '40700000-0000-0000-0000-0000000000c1'), 'paid'); END $$;

-- A guarda mais importante da secao: o DONO e quem a policy de SELECT de
-- `group_bill_payments` autoriza a ver as linhas de TODOS os membros. E
-- justamente para ele que o LEFT JOIN sem filtro duplicaria a agenda.
-- O D ve as suas 7: CG1, CG2, CG3, P1, P2, P3, e nao PE1 (que e do E).
DO $$ BEGIN PERFORM pg_temp.expect('o DONO ve 6 linhas, e nao 7 (as 2 linhas de pagamento de CG1 nao a dobram)',
  (SELECT count(*) FROM public.scheduled_transactions_effective), 6); END $$;

-- =====================================================
-- SECAO 2: O QUE NAO PODE MUDAR
-- =====================================================
-- Esta e a secao que autoriza as oito leituras do app a trocarem `status` por
-- `my_status` sem nenhuma mudar de numero. Ela e sobre TODA linha que e minha --
-- inclusive a conta de GRUPO que eu possuo, que e o caso em que as duas colunas
-- poderiam divergir por engano.
DO $$
DECLARE
  v_total     bigint;
  v_divergem  bigint;
BEGIN
  SELECT count(*) INTO v_total
    FROM public.scheduled_transactions_effective
   WHERE user_id = '40700000-0000-0000-0000-00000000000d';

  SELECT count(*) INTO v_divergem
    FROM public.scheduled_transactions_effective
   WHERE user_id = '40700000-0000-0000-0000-00000000000d'
     AND (my_status IS DISTINCT FROM status::text
          OR my_effective_status IS DISTINCT FROM effective_status::text);

  -- O controle positivo da propria secao: sem ele, uma view que devolvesse zero
  -- linha para o dono passaria com `v_divergem = 0`.
  PERFORM pg_temp.expect('a secao 2 esta medindo (linhas do proprio dono)', v_total, 6);
  PERFORM pg_temp.expect('para TODA linha minha, my_status = status e my_effective_status = effective_status',
                         v_divergem, 0);
END $$;

-- E os tres casos nominais, porque "zero divergencias" nao diz QUAIS estados
-- passaram pela comparacao.
DO $$ BEGIN PERFORM pg_temp.expect_text('pessoal pending no futuro -> my_effective_status = pending',
  (SELECT my_effective_status FROM public.scheduled_transactions_effective
    WHERE id = '40700000-0000-0000-0000-0000000000d1'), 'pending'); END $$;
DO $$ BEGIN PERFORM pg_temp.expect_text('pessoal pending VENCIDA -> my_effective_status = overdue',
  (SELECT my_effective_status FROM public.scheduled_transactions_effective
    WHERE id = '40700000-0000-0000-0000-0000000000d2'), 'overdue'); END $$;
-- `skipped` nao e `pending`, entao o CASE do overdue nao o alcanca -- a mesma
-- regra do `effective_status` do 005.
DO $$ BEGIN PERFORM pg_temp.expect_text('pessoal skipped -> my_effective_status = skipped (nao overdue)',
  (SELECT my_effective_status FROM public.scheduled_transactions_effective
    WHERE id = '40700000-0000-0000-0000-0000000000d3'), 'skipped'); END $$;

-- =====================================================
-- SECAO 3: `reported` NAO VIRA `overdue`
-- =====================================================
-- CG2 venceu ha cinco dias. O E avisou que pagou; o A nao. As duas afirmacoes
-- saem da MESMA linha, com a MESMA data -- e e so assim que "quem avisou nao
-- esta em atraso" se distingue de "o CASE do overdue nao foi escrito".
SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000e';
DO $$ BEGIN PERFORM pg_temp.expect_text('CG2 venceu e o E avisou: my_effective_status = reported, nao overdue',
  (SELECT my_effective_status FROM public.scheduled_transactions_effective
    WHERE id = '40700000-0000-0000-0000-0000000000c2'), 'reported'); END $$;
-- A coluna VELHA continua dizendo overdue para a mesma linha: as duas discordam
-- de proposito, e esta assercao e o que mostra que a secao 3 nao e vacua.
DO $$ BEGIN PERFORM pg_temp.expect_text('e o effective_status da MESMA linha continua overdue',
  (SELECT effective_status::text FROM public.scheduled_transactions_effective
    WHERE id = '40700000-0000-0000-0000-0000000000c2'), 'overdue'); END $$;

SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000a';
DO $$ BEGIN PERFORM pg_temp.expect_text('CG2 venceu e o A nao avisou: my_effective_status = overdue',
  (SELECT my_effective_status FROM public.scheduled_transactions_effective
    WHERE id = '40700000-0000-0000-0000-0000000000c2'), 'overdue'); END $$;

-- =====================================================
-- SECAO 4: A ESCRITA DO MEMBRO, SOB RLS
-- =====================================================
-- A bancada e CG3 (`pending`, sem linha de pagamento nenhuma).
SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000a';

DO $$ BEGIN PERFORM pg_temp.expect_aceita('o membro cria a propria linha em pending', $sql$
  INSERT INTO public.group_bill_payments (scheduled_transaction_id, user_id, status)
  VALUES ('40700000-0000-0000-0000-0000000000c3',
          '40700000-0000-0000-0000-00000000000a', 'pending')
$sql$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_aceita('o membro leva pending -> reported', $sql$
  UPDATE public.group_bill_payments
     SET status = 'reported', reported_at = now()
   WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c3'
     AND user_id = '40700000-0000-0000-0000-00000000000a'
$sql$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_text('e o my_status dele em CG3 virou reported',
  (SELECT my_status FROM public.scheduled_transactions_effective
    WHERE id = '40700000-0000-0000-0000-0000000000c3'), 'reported'); END $$;

-- `reported -> paid` NAO e barrado por erro: o `USING` da policy exige
-- `pending`, a linha ja esta `reported`, e o UPDATE casa ZERO linhas e volta com
-- SUCESSO. Ver o cabecalho de `expect_nenhuma_linha`.
DO $$ BEGIN PERFORM pg_temp.expect_nenhuma_linha('o membro NAO leva reported -> paid (a policy nao o alcanca mais)', $sql$
  UPDATE public.group_bill_payments
     SET status = 'paid', confirmed_at = now()
   WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c3'
     AND user_id = '40700000-0000-0000-0000-00000000000a'
$sql$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_text('e a linha dele continua reported',
  (SELECT my_status FROM public.scheduled_transactions_effective
    WHERE id = '40700000-0000-0000-0000-0000000000c3'), 'reported'); END $$;

-- Saindo de `pending`, o `WITH CHECK` e que recusa -- e esse da erro de
-- verdade, porque a linha ANTIGA casou com o `USING`.
--
-- O claim troca ANTES do INSERT: a policy exige `user_id = auth.uid()`, entao
-- com o claim do A este INSERT da linha do E seria recusado -- e o teste
-- reprovaria no lugar errado.
SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000e';
DO $$ BEGIN PERFORM pg_temp.expect_aceita('o E tambem cria a linha dele em CG3 (pending)', $sql$
  INSERT INTO public.group_bill_payments (scheduled_transaction_id, user_id, status)
  VALUES ('40700000-0000-0000-0000-0000000000c3',
          '40700000-0000-0000-0000-00000000000e', 'pending')
$sql$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_recusa('o membro NAO pula de pending direto para paid', $sql$
  UPDATE public.group_bill_payments
     SET status = 'paid', confirmed_at = now()
   WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c3'
     AND user_id = '40700000-0000-0000-0000-00000000000e'
$sql$, '42501'); END $$;

-- O INSERT tambem nao nasce `paid`.
--
-- A linha e a DELE e a conta e CG1 (onde o E nao tem linha), e as duas escolhas
-- sao a assercao: escrita com `user_id` de outra pessoa, esta recusa vinha do
-- `user_id = auth.uid()` da policy e o
-- `AND status IN ('pending','reported')` podia ser apagado sem o teste notar --
-- medido, o mutante `insert-aceita-paid` sobrevivia. E em CG2 o E ja tem linha,
-- entao a recusa viria da UNIQUE (23505) em vez da policy.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('o membro NAO cria a PROPRIA linha ja paga', $sql$
  INSERT INTO public.group_bill_payments
    (scheduled_transaction_id, user_id, status, confirmed_at)
  VALUES ('40700000-0000-0000-0000-0000000000c1',
          '40700000-0000-0000-0000-00000000000e', 'paid', now())
$sql$, '42501'); END $$;

-- E nao cria linha NO NOME DE OUTRA PESSOA.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('o membro NAO cria linha no nome de outro membro', $sql$
  INSERT INTO public.group_bill_payments (scheduled_transaction_id, user_id, status)
  VALUES ('40700000-0000-0000-0000-0000000000c2',
          '40700000-0000-0000-0000-00000000000a', 'pending')
$sql$, '42501'); END $$;

-- O DESFAZER: apagar a propria linha e voltar a `pending`, porque linha ausente
-- E `pending`. Sem a policy de DELETE o membro que clicou por engano ficaria em
-- `reported` para sempre (a policy de UPDATE exige `pending` no `USING`).
SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000a';
DO $$ BEGIN PERFORM pg_temp.expect_aceita('o membro desfaz o proprio aviso (DELETE)', $sql$
  DELETE FROM public.group_bill_payments
   WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c3'
     AND user_id = '40700000-0000-0000-0000-00000000000a'
$sql$); END $$;
DO $$ BEGIN PERFORM pg_temp.expect_text('e o my_status dele voltou a pending pela AUSENCIA da linha',
  (SELECT my_status FROM public.scheduled_transactions_effective
    WHERE id = '40700000-0000-0000-0000-0000000000c3'), 'pending'); END $$;

-- Mas nao apaga o que o dono ja confirmou, nem a linha de outro.
DO $$ BEGIN PERFORM pg_temp.expect_nenhuma_linha('o membro NAO apaga a linha que o dono confirmou (paid)', $sql$
  DELETE FROM public.group_bill_payments
   WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c1'
     AND user_id = '40700000-0000-0000-0000-00000000000b'
$sql$); END $$;

-- =====================================================
-- SECAO 5: A TRIGGER, ISOLADA
-- =====================================================
-- Desenho da secao 4.1 do teste da 053: o role volta a ser o dono das tabelas
-- (RLS FORA do caminho) e o claim CONTINUA sendo o do membro. `auth.uid()` le o
-- claim da SESSAO e nao o role, entao a trigger continua respondendo quem
-- clicou. Sem isto, toda recusa desta secao poderia ser da policy, e apagar a
-- trigger deixaria o arquivo verde.
RESET ROLE;
SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000e';

-- O REPONTAMENTO -- o buraco que so a trigger fecha.
--
-- Este comando passa pelas DUAS metades da policy de UPDATE: o `USING` ve a
-- linha ANTIGA e aprova pela metade do membro (e minha e esta `pending`); o
-- `WITH CHECK` ve a NOVA e aprova pela metade do dono, porque depois do
-- repontamento o E E o dono da conta prevista apontada (PE1 e dele). Nenhuma das
-- duas metades ve os dois lados -- e e por isso que `confirmed_at` forjado
-- passaria.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('a TRIGGER recusa o repontamento que se da por pago', $sql$
  UPDATE public.group_bill_payments
     SET scheduled_transaction_id = '40700000-0000-0000-0000-0000000000e1',
         status = 'paid',
         confirmed_at = now()
   WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c3'
     AND user_id = '40700000-0000-0000-0000-00000000000e'
$sql$, '42501'); END $$;

-- O REPONTAMENTO COM A TRANSICAO LEGAL -- e esta e a assercao que isola o pin
-- de `scheduled_transaction_id`.
--
-- A de cima nao o isolava: ela leva `status = 'paid'`, e a conferencia de
-- TRANSICAO ja a recusa antes de o pin ser consultado. Medido: o mutante
-- `pin-sem-scheduled-transaction-id` SOBREVIVIA com a assercao anterior
-- sozinha. Aqui a transicao e `pending -> reported`, perfeitamente legal, e a
-- UNICA coisa errada e o destino da linha -- entao so o pin pode recusar.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('a TRIGGER recusa o repontamento mesmo com a transicao legal', $sql$
  UPDATE public.group_bill_payments
     SET scheduled_transaction_id = '40700000-0000-0000-0000-0000000000e1',
         status = 'reported',
         reported_at = now()
   WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c3'
     AND user_id = '40700000-0000-0000-0000-00000000000e'
$sql$, '42501'); END $$;

-- O pin de colunas, sem repontar: o membro nao confirma a si mesmo nem reescreve
-- o `created_at` no mesmo UPDATE do aviso.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('a TRIGGER recusa o membro gravando confirmed_at junto com o aviso', $sql$
  UPDATE public.group_bill_payments
     SET status = 'reported', reported_at = now(), confirmed_at = now()
   WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c3'
     AND user_id = '40700000-0000-0000-0000-00000000000e'
$sql$, '42501'); END $$;

-- `created_at = now()` NAO serve aqui, e isto custou uma volta: `now()` e o
-- instante de inicio da TRANSACAO, a linha foi inserida nesta mesma transacao
-- com `DEFAULT now()`, e o `IS DISTINCT FROM` da trigger nao ve diferenca
-- nenhuma. O UPDATE passava, e a assercao reprovava com a trava INTACTA.
-- Qualquer valor visivelmente diferente resolve.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('a TRIGGER recusa o membro reescrevendo created_at', $sql$
  UPDATE public.group_bill_payments
     SET status = 'reported', reported_at = now(), created_at = now() - interval '1 day'
   WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c3'
     AND user_id = '40700000-0000-0000-0000-00000000000e'
$sql$, '42501'); END $$;

-- E o CONTROLE POSITIVO que prova que a trigger nao esta recusando tudo: o
-- aviso puro passa, e nesta mesma sessao sem RLS.
DO $$ BEGIN PERFORM pg_temp.expect_aceita('e o aviso puro do membro passa (pending -> reported)', $sql$
  UPDATE public.group_bill_payments
     SET status = 'reported', reported_at = now()
   WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c3'
     AND user_id = '40700000-0000-0000-0000-00000000000e'
$sql$); END $$;

-- AGORA a linha esta `reported`, e e so com ela nesse estado que a conferencia
-- de TRANSICAO fica isolada. Esta assercao precisou ser procurada, igual a
-- `transicao-do-devedor` da 053: todas as outras tentativas do membro mexem num
-- campo que o pin de colunas ja protege, entao continuam vermelhas mesmo com a
-- transicao apagada -- medido, o mutante
-- `transicao-do-membro-sem-conferencia` SOBREVIVIA a suite inteira.
--
-- Re-avisar numa linha que JA esta `reported` nao toca nenhuma coluna pinada:
-- muda `status` (de reported para reported) e `reported_at`. Sem a conferencia
-- de transicao o membro RETRODATA o proprio aviso -- grava "paguei no dia 5"
-- tendo avisado no dia 20 --, e a tela do grupo mostra a data forjada.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('a TRIGGER recusa o membro RETRODATANDO um aviso ja dado', $sql$
  UPDATE public.group_bill_payments
     SET status = 'reported', reported_at = now() - interval '15 days'
   WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c3'
     AND user_id = '40700000-0000-0000-0000-00000000000e'
$sql$, '42501'); END $$;

-- O segundo controle positivo, do outro lado: com o claim do DONO o
-- `reported -> paid` passa. Sem esta assercao, `paid` seria um estado que o
-- CHECK aceita e ninguem escreve -- e a trava "o membro nao confirma" ficaria
-- verde por nao haver confirmacao nenhuma no sistema.
SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000d';
DO $$ BEGIN PERFORM pg_temp.expect_aceita('o DONO confirma (reported -> paid)', $sql$
  UPDATE public.group_bill_payments
     SET status = 'paid', confirmed_at = now()
   WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c3'
     AND user_id = '40700000-0000-0000-0000-00000000000e'
$sql$); END $$;

-- Nem o dono reponta.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('nem o DONO reponta a linha para outra pessoa', $sql$
  UPDATE public.group_bill_payments
     SET user_id = '40700000-0000-0000-0000-00000000000a'
   WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c3'
     AND user_id = '40700000-0000-0000-0000-00000000000e'
$sql$, '42501'); END $$;

-- Quem nao e nenhum dos dois cai na rede por baixo da RLS.
SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000c';
DO $$ BEGIN PERFORM pg_temp.expect_recusa('a TRIGGER recusa quem nao e o dono nem o membro da linha', $sql$
  UPDATE public.group_bill_payments
     SET status = 'reported', reported_at = now()
   WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c1'
     AND user_id = '40700000-0000-0000-0000-00000000000a'
$sql$, '42501'); END $$;

-- =====================================================
-- SECAO 6: QUEM NAO LE E QUEM NAO ESCREVE
-- =====================================================
SET LOCAL ROLE authenticated;

-- O NAO-MEMBRO.
SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000c';
DO $$ BEGIN PERFORM pg_temp.expect('o nao-membro nao ve linha de pagamento nenhuma',
  (SELECT count(*) FROM public.group_bill_payments), 0); END $$;
DO $$ BEGIN PERFORM pg_temp.expect('o nao-membro nao ve a conta do grupo na agenda',
  (SELECT count(*) FROM public.scheduled_transactions_effective), 0); END $$;
DO $$ BEGIN PERFORM pg_temp.expect_recusa('o nao-membro nao cria linha na conta do grupo', $sql$
  INSERT INTO public.group_bill_payments (scheduled_transaction_id, user_id, status)
  VALUES ('40700000-0000-0000-0000-0000000000c2',
          '40700000-0000-0000-0000-00000000000c', 'pending')
$sql$, '42501'); END $$;

-- O EX-MEMBRO (`removed`). E ELE que mede o `active` de dentro do
-- `is_group_member`: o nao-membro acima seria recusado mesmo por uma policy que
-- tivesse esquecido o `status = 'active'`.
SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000f';
DO $$ BEGIN PERFORM pg_temp.expect_recusa('o EX-membro (removed) nao cria linha na conta do grupo', $sql$
  INSERT INTO public.group_bill_payments (scheduled_transaction_id, user_id, status)
  VALUES ('40700000-0000-0000-0000-0000000000c2',
          '40700000-0000-0000-0000-00000000000f', 'pending')
$sql$, '42501'); END $$;

-- UM MEMBRO ATIVO NAO VE A LINHA DE OUTRO. A policy de SELECT de
-- `group_bill_payments` de proposito NAO usa `is_group_member` -- copiar a forma
-- da policy de `scheduled_transactions` (`005:310-316`) entregaria o estado de
-- pagamento de todo mundo a qualquer membro.
SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000a';
DO $$ BEGIN PERFORM pg_temp.expect('o membro ve 1 linha de CG1 (a dele), e nao as 2',
  (SELECT count(*) FROM public.group_bill_payments
    WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c1'), 1); END $$;

-- E o DONO da conta prevista ve as duas -- o controle positivo da mesma policy,
-- e o que a tela "D pagou · A avisou que pagou · E pendente" precisa.
SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000d';
DO $$ BEGIN PERFORM pg_temp.expect('o DONO da conta prevista ve as 2 linhas de CG1',
  (SELECT count(*) FROM public.group_bill_payments
    WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c1'), 2); END $$;

RESET ROLE;

-- =====================================================
-- SECAO 7: O CATALOGO
-- =====================================================
-- `security_invoker` pelo CATALOGO, e nao por comportamento: neste banco o dono
-- das tabelas e superusuario e bypassa RLS, entao uma view furada daria o MESMO
-- resultado no caminho felizes das secoes acima.
--
-- `CREATE OR REPLACE VIEW` apaga reloptions, e a 055 recria esta view. Sem o
-- `ALTER VIEW ... SET (security_invoker = true)` do fim dela, a agenda de cada
-- usuario passaria a listar as contas de TODO MUNDO -- e o `my_status` tambem
-- deixaria de valer, porque o LEFT JOIN veria as linhas de pagamento de todos.
DO $$ BEGIN PERFORM pg_temp.expect('scheduled_transactions_effective tem security_invoker (catalogo)',
  (SELECT count(*) FROM pg_class
    WHERE relname = 'scheduled_transactions_effective'
      AND relnamespace = 'public'::regnamespace
      AND 'security_invoker=true' = ANY(COALESCE(reloptions, ARRAY[]::text[]))), 1); END $$;

-- A LISTA ORDENADA das colunas. E esta assercao que prende as duas novas no FIM
-- e as vinte antigas na posicao e no nome que tinham -- o que torna legitima a
-- troca de `status` por `my_status` nas oito leituras do app. Um
-- `CREATE OR REPLACE` futuro que reordene ou renomeie reprova aqui com a lista
-- inteira na mensagem.
DO $$ BEGIN PERFORM pg_temp.expect_text('as 22 colunas da view, na ordem, com as duas novas no FIM',
  (SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
     FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'scheduled_transactions_effective'),
  'id,user_id,recurring_rule_id,category_id,account_id,group_id,description,'
  'amount,due_date,status,paid_date,transaction_id,notes,created_at,updated_at,'
  'currency,transaction_type,effective_status,days_until_due,direction,'
  'my_status,my_effective_status'); END $$;

-- A UNIQUE. Ela nao e higiene: e ela, mais o `AND p.user_id = auth.uid()` do
-- join, que garantem que o LEFT JOIN novo nao multiplique a agenda.
DO $$ BEGIN PERFORM pg_temp.expect('a UNIQUE (scheduled_transaction_id, user_id) existe',
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.group_bill_payments'::regclass
      AND contype = 'u'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.group_bill_payments'::regclass
          AND attname = 'scheduled_transaction_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.group_bill_payments'::regclass
          AND attname = 'user_id')]::smallint[]), 1); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_recusa('e a segunda linha da mesma pessoa na mesma conta e recusada', $sql$
  INSERT INTO public.group_bill_payments (scheduled_transaction_id, user_id, status)
  VALUES ('40700000-0000-0000-0000-0000000000c1',
          '40700000-0000-0000-0000-00000000000a', 'pending')
$sql$, '23505'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect('group_bill_payments tem RLS ligada',
  (SELECT count(*) FROM pg_class WHERE oid = 'public.group_bill_payments'::regclass
     AND relrowsecurity), 1); END $$;

DO $$ BEGIN PERFORM pg_temp.expect('as 4 policies de group_bill_payments existem',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'group_bill_payments'), 4); END $$;

-- `anon`. O 002 rodou `GRANT ... ON ALL TABLES` antes desta tabela existir, e
-- ALL TABLES e uma fotografia do momento -- entao isto nao e automatico, e o
-- REVOKE da 055 e que responde.
DO $$ BEGIN PERFORM pg_temp.expect('anon nao le group_bill_payments',
  (SELECT count(*) FROM (SELECT has_table_privilege('anon', 'public.group_bill_payments', 'SELECT') AS p) s
    WHERE p), 0); END $$;

-- A funcao da trava e DEFINER: `anon` com EXECUTE nela seria rodar codigo com o
-- privilegio do dono a partir de uma sessao nao autenticada. O Postgres concede
-- EXECUTE a PUBLIC por default, entao so o `REVOKE ... FROM PUBLIC` e que tira
-- isto -- um revoke apenas do `anon` nao tiraria nada.
DO $$ BEGIN PERFORM pg_temp.expect('anon nao executa group_bill_payments_trava_do_membro',
  (SELECT count(*) FROM (SELECT has_function_privilege('anon',
     'public.group_bill_payments_trava_do_membro()', 'EXECUTE') AS p) s WHERE p), 0); END $$;

-- =====================================================
-- SECAO 8: O CONTROLE NEGATIVO
-- =====================================================
-- Reproduz o join SEM o `AND p.user_id = auth.uid()` sobre a MESMA fixture e
-- EXIGE o numero errado. No desenho do caso 3 do
-- `043_direcao_do_previsto_avulso_test.sql`: ele falha no dia em que a fixture
-- deixar de conter o caso -- e nesse dia as secoes 1 e 2 param de medir sem
-- avisar.
--
-- Roda como o dono das tabelas (RLS fora do caminho) para que as duas
-- contagens -- a da view de verdade e a do join sem filtro -- tenham o MESMO
-- escopo e a diferenca seja so o filtro.
SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000d';

DO $$ BEGIN PERFORM pg_temp.expect('a view de verdade devolve CG1 UMA vez',
  (SELECT count(*) FROM public.scheduled_transactions_effective
    WHERE id = '40700000-0000-0000-0000-0000000000c1'), 1); END $$;

DO $$ BEGIN PERFORM pg_temp.expect('SEM o filtro de auth.uid(), CG1 sairia DUAS vezes (o defeito)',
  (SELECT count(*)
     FROM public.scheduled_transactions s
     LEFT JOIN public.group_bill_payments p ON p.scheduled_transaction_id = s.id
    WHERE s.id = '40700000-0000-0000-0000-0000000000c1'), 2); END $$;

-- A outra metade do mesmo defeito, e e a que apaga o NUMERO DA ISSUE: lido pelo
-- E (que nao tem linha em CG1), o join sem filtro acha as linhas do A e do B e
-- o `pending` do E desaparece.
SET LOCAL request.jwt.claim.sub = '40700000-0000-0000-0000-00000000000e';

DO $$ BEGIN PERFORM pg_temp.expect('a view de verdade da pending para o E em CG1',
  (SELECT count(*) FROM public.scheduled_transactions_effective
    WHERE id = '40700000-0000-0000-0000-0000000000c1' AND my_status = 'pending'), 1); END $$;

DO $$ BEGIN PERFORM pg_temp.expect('SEM o filtro, o pending do E em CG1 DESAPARECE (0 linhas)',
  (SELECT count(*) FROM (
     SELECT CASE
              WHEN s.user_id = auth.uid() THEN s.status::text
              ELSE COALESCE(p.status, 'pending')
            END AS my_status
       FROM public.scheduled_transactions s
       LEFT JOIN public.group_bill_payments p ON p.scheduled_transaction_id = s.id
      WHERE s.id = '40700000-0000-0000-0000-0000000000c1'
   ) q WHERE q.my_status = 'pending'), 0); END $$;

-- =====================================================
-- SECAO 9: O CHECK DOS CARIMBOS E O CASCADE
-- =====================================================
-- O CHECK e o que impede "a Lais avisou que pagou em --/--/----" na tela do
-- grupo.
DO $$ BEGIN PERFORM pg_temp.expect_recusa('reported sem reported_at e recusado', $sql$
  INSERT INTO public.group_bill_payments (scheduled_transaction_id, user_id, status)
  VALUES ('40700000-0000-0000-0000-0000000000c2',
          '40700000-0000-0000-0000-00000000000b', 'reported')
$sql$, '23514'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_recusa('pending com confirmed_at e recusado', $sql$
  INSERT INTO public.group_bill_payments
    (scheduled_transaction_id, user_id, status, confirmed_at)
  VALUES ('40700000-0000-0000-0000-0000000000c2',
          '40700000-0000-0000-0000-00000000000b', 'pending', now())
$sql$, '23514'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_recusa('status fora do dominio e recusado', $sql$
  INSERT INTO public.group_bill_payments (scheduled_transaction_id, user_id, status)
  VALUES ('40700000-0000-0000-0000-0000000000c2',
          '40700000-0000-0000-0000-00000000000b', 'skipped')
$sql$, '23514'); END $$;

-- O CASCADE: apagar a conta prevista leva as linhas de pagamento dela. Sem ele,
-- a tabela acumularia linha orfa apontando para conta que nao existe mais, e a
-- UNIQUE impediria a pessoa de avisar de novo numa conta recriada.
DO $$ BEGIN PERFORM pg_temp.expect('ANTES do DELETE, CG3 tem 1 linha de pagamento',
  (SELECT count(*) FROM public.group_bill_payments
    WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c3'), 1); END $$;

DELETE FROM public.scheduled_transactions
 WHERE id = '40700000-0000-0000-0000-0000000000c3';

DO $$ BEGIN PERFORM pg_temp.expect('DEPOIS do DELETE, nenhuma linha orfa de CG3',
  (SELECT count(*) FROM public.group_bill_payments
    WHERE scheduled_transaction_id = '40700000-0000-0000-0000-0000000000c3'), 0); END $$;

ROLLBACK;
