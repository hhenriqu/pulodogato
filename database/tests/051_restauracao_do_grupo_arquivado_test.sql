-- =====================================================
-- Teste da restauracao do grupo arquivado (051)
-- =====================================================
-- A HMO-203 mediu em PRODUCAO: `POST /api/expense-groups/{id}/restore` responde
-- HTTP 200 "Grupo restaurado com sucesso!" e o grupo continua arquivado. A
-- causa esta no banco: arquivar poe o proprio admin em
-- `group_members.status = 'archived'`, `is_group_admin()` exige 'active', e a
-- policy de UPDATE de `expense_groups` e `USING (is_group_admin(id))`. Nao ha
-- quem restaure.
--
-- ===========================================================================
-- A ARMADILHA DESTE ARQUIVO, E O QUE ELE FAZ CONTRA ELA
-- ===========================================================================
-- Escrita barrada pela RLS volta SUCESSO COM ZERO LINHAS, nao erro -- e foi
-- exatamente isso que fez a rota mentir. Um teste que apenas chame a funcao e
-- confira `is_active = true` passaria verde em dois mundos:
--
--   1. a funcao restaurou                     <- o que este arquivo quer provar
--   2. o grupo nunca esteve arquivado de verdade (fixture que nao arquivou o
--      ADMIN, por exemplo) -- ali a policy antiga ja bastava, e a 051 nao seria
--      necessaria para nada
--
-- Por isso a SECAO 1 e um CONTROLE POSITIVO DO BURACO: com a identidade do
-- admin arquivado, o UPDATE direto em `expense_groups` -- o PATCH que a rota
-- fazia -- afeta ZERO linha e nao levanta nada. Se um dia essa secao falhar
-- ("afetou 1 linha"), o poco deixou de existir por outro caminho e o resto do
-- arquivo esta medindo o vazio.
--
-- ===========================================================================
-- O QUE CADA SECAO RESPONDE
-- ===========================================================================
--   1. CONTROLE POSITIVO DO BURACO: o UPDATE direto do admin arquivado afeta 0
--      linha, em silencio -- e `is_group_admin()` devolve FALSE para ele;
--   2. CONTROLE POSITIVO DO PRODUTO: a funcao restaura. Grupo ativo,
--      `archived_at` limpo, `restored_at`/`restored_by` gravados, TODOS os
--      membros de volta a 'active' -- e `is_group_admin()` voltando a TRUE, que
--      e o que devolve o grupo as telas;
--   3. a resposta e LIDA DE VOLTA do banco: o `restored_at` devolvido e o mesmo
--      que ficou gravado na linha. A rota antiga exibia um
--      `new Date().toISOString()` montado em JavaScript -- descrevia a escrita
--      em vez de medir;
--   4. a funcao escreve SEIS colunas e mais nenhuma: `name`, `group_code`,
--      `created_by` e `description` saem intactos. E o que uma policy afrouxada
--      nao daria;
--   5. O ESTADO PARCIAL, o item 4 da issue: grupo `is_active = false` com admin
--      `status = 'active'` -- o estado que a rota antiga produzia e que nenhuma
--      tela alcanca. A funcao tem de aceitar esse admin (ele nao esta
--      'archived') e nao sobrar `is_active = false` com membro 'active';
--   6. ATOMICIDADE, os dois lados: (a) se o UPDATE dos membros estourar, o
--      grupo NAO fica ativo; (b) se ele passar sem gravar -- trigger que
--      descarta a linha, o jeito silencioso de falhar --, a conferencia de
--      invariante da propria funcao desfaz tudo. Nos dois casos o grupo
--      continua arquivado, e dizendo que continua;
--   7. as recusas, cada uma com o seu SQLSTATE, que e o contrato com a rota:
--      membro comum 42501, nao-membro e ex-membro P0002, grupo ja ativo PDG01,
--      sem autenticacao 28000;
--   8. ACL: `authenticated` executa, `anon` nao.
--
-- Rodar depois de 001 -> ... -> 051:
--   psql "$DB_URL" -f database/tests/051_restauracao_do_grupo_arquivado_test.sql
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

-- Recusa com SQLSTATE exigido. Tres desfechos e so um passa:
--
--   * nao levantou nada -> FALHA. Inclui o caso em que a funcao "deu certo"
--     para quem nao devia, e o caso em que ela devolveu zero linha calada;
--   * levantou o SQLSTATE esperado -> ok (a mensagem vai para o NOTICE);
--   * levantou outro SQLSTATE -> FALHA dizendo qual veio. Isto nao e
--     preciosismo: 42501 tambem e o que o Postgres levanta quando falta o
--     GRANT de EXECUTE, e esse estado -- em que NINGUEM restaura -- sairia
--     verde se o arquivo so exigisse "deu erro".
CREATE OR REPLACE FUNCTION pg_temp.recusa(rotulo TEXT, comando TEXT, sqlstate_esperado TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_estado TEXT;
  v_msg    TEXT;
BEGIN
  BEGIN
    EXECUTE comando;
    RAISE EXCEPTION
      'FALHA: % -> o comando NAO foi recusado: nenhuma excecao. Esperava SQLSTATE %.',
      rotulo, sqlstate_esperado;
  EXCEPTION
    WHEN OTHERS THEN
      v_estado := SQLSTATE;
      v_msg    := SQLERRM;
      IF v_estado = 'P0001' AND v_msg LIKE 'FALHA:%' THEN
        RAISE EXCEPTION '%', v_msg;   -- a falha acima, repassada intacta
      END IF;
      IF v_estado IS DISTINCT FROM sqlstate_esperado THEN
        RAISE EXCEPTION
          'FALHA: % -> esperava SQLSTATE %, veio % ("%")',
          rotulo, sqlstate_esperado, v_estado, v_msg;
      END IF;
      RAISE NOTICE 'ok: % -> recusado com % ("%")', rotulo, v_estado, v_msg;
  END;
END $$;

-- =====================================================
-- Fixture: um grupo arquivado do jeito que a rota arquiva
-- =====================================================
-- A e admin, B e membro comum, F e um nao-membro, R e um ex-membro
-- ('removed') -- ele existe para provar que "ja foi do grupo" nao basta.
--
-- `group_members_user_id_fkey` aponta para `profiles`, nao para `auth.users`:
-- as duas linhas sao necessarias -- `auth.users` para o claim fazer sentido,
-- `profiles` para a FK fechar.
INSERT INTO auth.users (id, email) VALUES
  ('aaaa0051-0000-0000-0000-00000000000a', 'admin@g051.local'),
  ('aaaa0051-0000-0000-0000-00000000000b', 'membro@g051.local'),
  ('aaaa0051-0000-0000-0000-00000000000f', 'forasteiro@g051.local'),
  ('aaaa0051-0000-0000-0000-00000000000d', 'exmembro@g051.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('aaaa0051-0000-0000-0000-00000000000a', 'Admin A',     FALSE),
  ('aaaa0051-0000-0000-0000-00000000000b', 'Membro B',    FALSE),
  ('aaaa0051-0000-0000-0000-00000000000f', 'Forasteiro F', FALSE),
  ('aaaa0051-0000-0000-0000-00000000000d', 'Ex-membro R', FALSE);

-- G1 arquivado (o caso da issue), G2 ativo (para "ja esta ativo"), G3 no estado
-- parcial da SECAO 5. Inserir o grupo JA CRIA a linha do criador como
-- admin/active (trigger do 001), entao a linha do A nao e inserida abaixo --
-- inseri-la daria `unique_user_per_group`.
INSERT INTO public.expense_groups (id, name, description, created_by, group_type, group_code) VALUES
  ('bbbb0051-0000-0000-0000-000000000001', 'Viagem a Bahia', 'rateio da casa',
   'aaaa0051-0000-0000-0000-00000000000a', 'private', 'G51AR1'),
  ('bbbb0051-0000-0000-0000-000000000002', 'Grupo ativo', NULL,
   'aaaa0051-0000-0000-0000-00000000000a', 'private', 'G51AT2'),
  ('bbbb0051-0000-0000-0000-000000000003', 'Meio arquivado', NULL,
   'aaaa0051-0000-0000-0000-00000000000a', 'private', 'G51PA3');

INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('bbbb0051-0000-0000-0000-000000000001',
   'aaaa0051-0000-0000-0000-00000000000b', 'member', 'active'),
  ('bbbb0051-0000-0000-0000-000000000001',
   'aaaa0051-0000-0000-0000-00000000000d', 'member', 'removed'),
  ('bbbb0051-0000-0000-0000-000000000003',
   'aaaa0051-0000-0000-0000-00000000000b', 'member', 'archived');

-- ARQUIVA O G1 EXATAMENTE COMO A ROTA ARQUIVA (DELETE de
-- app/api/expense-groups/[groupId]/route.ts): o grupo e, no segundo UPDATE,
-- TODOS os membros 'active' -- inclusive o ADMIN. E esse segundo UPDATE que
-- cria o poco, e e por isso que a fixture nao pode simplificar aqui.
UPDATE public.expense_groups
   SET is_active = FALSE,
       archived_at = '2026-09-30 12:00:00+00',
       archived_by = 'aaaa0051-0000-0000-0000-00000000000a'
 WHERE id = 'bbbb0051-0000-0000-0000-000000000001';

UPDATE public.group_members
   SET status = 'archived', archived_at = '2026-09-30 12:00:00+00'
 WHERE group_id = 'bbbb0051-0000-0000-0000-000000000001'
   AND status = 'active';

-- O G3 e o ESTADO PARCIAL: o grupo ficou arquivado e o admin voltou a 'active'
-- -- o que a rota antiga produzia quando o primeiro UPDATE nao pegava e o
-- segundo passava. O membro B continua 'archived' ali, para a SECAO 5 poder
-- provar que ele volta junto.
UPDATE public.expense_groups
   SET is_active = FALSE,
       archived_at = '2026-09-30 12:00:00+00',
       archived_by = 'aaaa0051-0000-0000-0000-00000000000a'
 WHERE id = 'bbbb0051-0000-0000-0000-000000000003';

SELECT pg_temp.expect(
  'fixture: G1 arquivado, com o ADMIN tambem arquivado',
  (SELECT g.is_active::TEXT || ' / ' ||
          (SELECT string_agg(gm.role || '=' || gm.status, ',' ORDER BY gm.role, gm.status)
             FROM public.group_members gm WHERE gm.group_id = g.id)
     FROM public.expense_groups g
    WHERE g.id = 'bbbb0051-0000-0000-0000-000000000001'),
  'false / admin=archived,member=archived,member=removed');

SELECT pg_temp.expect(
  'fixture: G3 no estado parcial (grupo inativo, admin ativo)',
  (SELECT g.is_active::TEXT || ' / ' ||
          (SELECT string_agg(gm.role || '=' || gm.status, ',' ORDER BY gm.role)
             FROM public.group_members gm WHERE gm.group_id = g.id)
     FROM public.expense_groups g
    WHERE g.id = 'bbbb0051-0000-0000-0000-000000000003'),
  'false / admin=active,member=archived');

SELECT pg_temp.expect(
  'fixture: a funcao da 051 existe',
  (SELECT count(*)::TEXT FROM pg_proc
    WHERE oid = to_regprocedure('public.restore_archived_group(uuid)')),
  '1');

-- =====================================================
-- 1. CONTROLE POSITIVO DO BURACO: o admin arquivado nao escreve, e nao sabe
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0051-0000-0000-0000-00000000000a';

SELECT pg_temp.expect(
  'is_group_admin() e FALSE para o admin arquivado -- a policy de UPDATE sai daqui',
  public.is_group_admin('bbbb0051-0000-0000-0000-000000000001')::TEXT,
  'false');

-- O PATCH da rota antiga, em SQL. Nao levanta nada; afeta zero linha.
DO $$
DECLARE v_linhas BIGINT;
BEGIN
  UPDATE public.expense_groups
     SET is_active = TRUE, archived_at = NULL, archived_by = NULL,
         restored_at = NOW(), restored_by = auth.uid()
   WHERE id = 'bbbb0051-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  IF v_linhas <> 0 THEN
    RAISE EXCEPTION
      'FALHA: o UPDATE direto do admin arquivado afetou % linha(s). O poco da HMO-203 '
      'deixou de existir por outro caminho -- e todo o resto deste arquivo passou a '
      'medir o vazio. Confira a policy expense_groups_update e is_group_admin().',
      v_linhas;
  END IF;
  RAISE NOTICE 'ok: o UPDATE direto afetou 0 linha, sem erro -- a RLS filtra em silencio';
END $$;

RESET ROLE;
-- O claim sobrevive ao RESET ROLE: limpar aqui, senao a secao seguinte roda sob
-- a identidade do A sem dizer que roda.
SET LOCAL request.jwt.claim.sub = '';

SELECT pg_temp.expect(
  'e o grupo continua arquivado depois do UPDATE que "deu certo"',
  (SELECT is_active::TEXT || ' / ' || coalesce(restored_at::TEXT, 'null')
     FROM public.expense_groups WHERE id = 'bbbb0051-0000-0000-0000-000000000001'),
  'false / null');

-- =====================================================
-- 2. CONTROLE POSITIVO DO PRODUTO: a funcao restaura
-- =====================================================
-- A tabela nasce AQUI, como `postgres`, e com GRANT: `CREATE TEMP TABLE ... AS`
-- rodando sob `SET ROLE authenticated` precisaria de CREATE no schema temporario.
-- O que se quer medir e a chamada da funcao, nao a permissao de criar tabela.
CREATE TEMP TABLE resultado_g1 (
  group_id         UUID,
  group_name       TEXT,
  is_active        BOOLEAN,
  restored_at      TIMESTAMPTZ,
  members_restored INTEGER
);
GRANT INSERT, SELECT ON resultado_g1 TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0051-0000-0000-0000-00000000000a';

INSERT INTO resultado_g1
SELECT * FROM public.restore_archived_group('bbbb0051-0000-0000-0000-000000000001');

SELECT pg_temp.expect(
  'a funcao devolve o grupo ativo e quantos membros voltaram',
  (SELECT group_name || ' / ' || is_active::TEXT || ' / ' || members_restored::TEXT
     FROM resultado_g1),
  'Viagem a Bahia / true / 2');

SELECT pg_temp.expect(
  'is_group_admin() volta a TRUE -- e o que devolve o grupo as telas',
  public.is_group_admin('bbbb0051-0000-0000-0000-000000000001')::TEXT,
  'true');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

SELECT pg_temp.expect(
  'o grupo na tabela: ativo, sem marca de arquivamento, com restored_by',
  (SELECT is_active::TEXT || ' / ' ||
          coalesce(archived_at::TEXT, 'null') || ' / ' ||
          coalesce(archived_by::TEXT, 'null') || ' / ' ||
          coalesce(restored_by::TEXT, 'null')
     FROM public.expense_groups WHERE id = 'bbbb0051-0000-0000-0000-000000000001'),
  'true / null / null / aaaa0051-0000-0000-0000-00000000000a');

-- O admin E o membro comum voltaram. O 'removed' NAO voltou: quem foi tirado do
-- grupo nao reentra por desarquivamento -- seria readmitir pelas costas de quem
-- o removeu.
SELECT pg_temp.expect(
  'os membros: admin e member de volta a active, o removed intacto',
  (SELECT string_agg(role || '=' || status, ',' ORDER BY role, status)
     FROM public.group_members
    WHERE group_id = 'bbbb0051-0000-0000-0000-000000000001'),
  'admin=active,member=active,member=removed');

SELECT pg_temp.expect(
  'e nenhum membro restaurado ficou com archived_at para tras',
  (SELECT count(*)::TEXT FROM public.group_members
    WHERE group_id = 'bbbb0051-0000-0000-0000-000000000001'
      AND status = 'active' AND archived_at IS NOT NULL),
  '0');

-- =====================================================
-- 3. A RESPOSTA E LIDA DE VOLTA DO BANCO
-- =====================================================
-- O `restored_at` da resposta tem de ser o que ficou GRAVADO. A rota antiga
-- montava o dela com `new Date().toISOString()` em JavaScript, e foi assim que
-- "restaurado com sucesso!" acompanhou uma escrita que nunca aconteceu.
SELECT pg_temp.expect(
  'o restored_at devolvido e o mesmo da linha',
  (SELECT CASE WHEN r.restored_at = g.restored_at THEN 'igual'
               ELSE 'devolvido=' || coalesce(r.restored_at::TEXT, 'null') ||
                    ' gravado=' || coalesce(g.restored_at::TEXT, 'null') END
     FROM resultado_g1 r, public.expense_groups g
    WHERE g.id = 'bbbb0051-0000-0000-0000-000000000001'),
  'igual');

-- =====================================================
-- 4. A FUNCAO ESCREVE SEIS COLUNAS, E MAIS NENHUMA
-- =====================================================
-- Era a segunda razao para nao afrouxar a policy de UPDATE: policy limita
-- LINHA, nao COLUNA -- um admin arquivado com permissao de UPDATE poderia
-- reescrever o `group_code`, que e a chave de convite do grupo.
SELECT pg_temp.expect(
  'nome, descricao, codigo e criador saem intactos da restauracao',
  (SELECT name || ' / ' || coalesce(description, 'null') || ' / ' ||
          group_code || ' / ' || created_by::TEXT
     FROM public.expense_groups WHERE id = 'bbbb0051-0000-0000-0000-000000000001'),
  'Viagem a Bahia / rateio da casa / G51AR1 / aaaa0051-0000-0000-0000-00000000000a');

-- =====================================================
-- 4b. A RESPOSTA SAI DA LINHA, NAO DO RELOGIO
-- =====================================================
-- A SECAO 3 compara o `restored_at` devolvido com o gravado -- e isso, sozinho,
-- NAO distingue "leu de volta" de "montou": dentro de uma transacao `NOW()` e
-- constante, entao uma funcao que devolvesse `NOW()` sem olhar a linha daria
-- exatamente o mesmo valor. MEDIDO: o mutante
-- `resposta_montada_em_vez_de_lida` -- que e a rota antiga portada para dentro
-- do banco -- SOBREVIVEU com a SECAO 3 verde.
--
-- O que separa os dois mundos e uma linha cujo valor gravado NAO e o que a
-- funcao escreveu. Um trigger que carimba `restored_at` faz isso, e nao e
-- cenario inventado: e o que qualquer trigger de auditoria, default ou
-- normalizacao futura faria. Quem le de volta devolve o carimbo; quem monta
-- devolve o relogio.
UPDATE public.expense_groups
   SET is_active = FALSE, archived_at = '2026-09-30 12:00:00+00',
       archived_by = 'aaaa0051-0000-0000-0000-00000000000a',
       restored_at = NULL, restored_by = NULL
 WHERE id = 'bbbb0051-0000-0000-0000-000000000001';

UPDATE public.group_members
   SET status = 'archived', archived_at = '2026-09-30 12:00:00+00', restored_at = NULL
 WHERE group_id = 'bbbb0051-0000-0000-0000-000000000001'
   AND status = 'active';

CREATE FUNCTION pg_temp.carimba_restored_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.restored_at := '2001-09-11 00:00:00+00';   -- um valor que a funcao nunca escolheria
  RETURN NEW;
END $$;

CREATE TRIGGER trg_carimba_restored_at
  BEFORE UPDATE ON public.expense_groups
  FOR EACH ROW WHEN (NEW.is_active)
  EXECUTE FUNCTION pg_temp.carimba_restored_at();

CREATE TEMP TABLE resultado_carimbado (
  group_id         UUID,
  group_name       TEXT,
  is_active        BOOLEAN,
  restored_at      TIMESTAMPTZ,
  members_restored INTEGER
);
GRANT INSERT, SELECT ON resultado_carimbado TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0051-0000-0000-0000-00000000000a';

INSERT INTO resultado_carimbado
SELECT * FROM public.restore_archived_group('bbbb0051-0000-0000-0000-000000000001');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- Comparado como timestamptz, nao como texto: `::TEXT` sai no TimeZone da
-- sessao ('2001-09-10 21:00:00-03' aqui, '2001-09-11 00:00:00+00' num runner em
-- UTC), e o teste reprovaria pela maquina em vez de pelo codigo.
SELECT pg_temp.expect(
  '4b: o restored_at devolvido e o CARIMBADO na linha, nao o NOW() da funcao',
  (SELECT (restored_at = '2001-09-11 00:00:00+00'::TIMESTAMPTZ)::TEXT
     FROM resultado_carimbado),
  'true');

DROP TRIGGER trg_carimba_restored_at ON public.expense_groups;

-- 4c. A OUTRA PONTA DA MESMA CONFERENCIA: `is_active` gravou e a MARCA da
--     restauracao nao. A funcao exige as duas (`is_active IS NOT TRUE OR
--     restored_at IS NULL`), e sem o segundo termo ela devolveria
--     `restored_at = null` dizendo que restaurou -- a resposta que a HMO-203
--     media em producao, com a mesma forma e outro conteudo.
UPDATE public.expense_groups
   SET is_active = FALSE, archived_at = '2026-09-30 12:00:00+00',
       archived_by = 'aaaa0051-0000-0000-0000-00000000000a',
       restored_at = NULL, restored_by = NULL
 WHERE id = 'bbbb0051-0000-0000-0000-000000000001';

UPDATE public.group_members
   SET status = 'archived', archived_at = '2026-09-30 12:00:00+00', restored_at = NULL
 WHERE group_id = 'bbbb0051-0000-0000-0000-000000000001'
   AND status = 'active';

CREATE FUNCTION pg_temp.apaga_restored_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.restored_at := NULL;   -- o grupo reabre, a marca da restauracao nao grava
  RETURN NEW;
END $$;

CREATE TRIGGER trg_apaga_restored_at
  BEFORE UPDATE ON public.expense_groups
  FOR EACH ROW WHEN (NEW.is_active)
  EXECUTE FUNCTION pg_temp.apaga_restored_at();

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0051-0000-0000-0000-00000000000a';

SELECT pg_temp.recusa(
  '4c: is_active gravado mas restored_at nulo tambem e falha',
  $cmd$SELECT * FROM public.restore_archived_group('bbbb0051-0000-0000-0000-000000000001')$cmd$,
  '22000');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

DROP TRIGGER trg_apaga_restored_at ON public.expense_groups;

SELECT pg_temp.expect(
  '4c: e o grupo continua arquivado',
  (SELECT is_active::TEXT FROM public.expense_groups
    WHERE id = 'bbbb0051-0000-0000-0000-000000000001'),
  'false');

-- =====================================================
-- 5. O ESTADO PARCIAL (item 4 da issue)
-- =====================================================
-- G3: grupo `is_active = false` com o admin `status = 'active'`. Nenhuma tela
-- alcanca esse grupo -- a lista ativa filtra `is_active`, e a de arquivados
-- exige uma linha de membro 'archived' para o usuario, que ali nao existe mais.
-- O pre-check da rota antiga (`.eq("status","archived")`) tambem nao achava
-- nada e respondia 404. A funcao aceita esse admin de proposito: e por isso que
-- a autorizacao dela diz `status IN ('active','archived')`.
CREATE TEMP TABLE resultado_g3 (
  group_id         UUID,
  group_name       TEXT,
  is_active        BOOLEAN,
  restored_at      TIMESTAMPTZ,
  members_restored INTEGER
);
GRANT INSERT, SELECT ON resultado_g3 TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0051-0000-0000-0000-00000000000a';

INSERT INTO resultado_g3
SELECT * FROM public.restore_archived_group('bbbb0051-0000-0000-0000-000000000003');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

SELECT pg_temp.expect(
  'o admin JA ativo restaura o grupo meio arquivado',
  (SELECT is_active::TEXT || ' / ' || members_restored::TEXT FROM resultado_g3),
  'true / 1');

-- O invariante da issue, escrito como consulta: nao existe grupo inativo com
-- membro ativo. Vale para o banco inteiro, nao so para o G3 -- e assim ele
-- pega qualquer linha que as secoes anteriores tenham deixado torta.
SELECT pg_temp.expect(
  'nao sobrou NENHUM grupo is_active=false com membro active',
  (SELECT count(*)::TEXT
     FROM public.expense_groups g
     JOIN public.group_members gm ON gm.group_id = g.id
    WHERE g.is_active = FALSE AND gm.status = 'active'),
  '0');

-- =====================================================
-- 6. ATOMICIDADE, OS DOIS LADOS
-- =====================================================
-- Re-arquiva o G1 para ter o que restaurar de novo. DDL e transacional no
-- Postgres, entao os triggers de sabotagem abaixo nascem e morrem dentro desta
-- transacao, que termina em ROLLBACK.
UPDATE public.expense_groups
   SET is_active = FALSE, archived_at = '2026-09-30 12:00:00+00',
       archived_by = 'aaaa0051-0000-0000-0000-00000000000a',
       restored_at = NULL, restored_by = NULL
 WHERE id = 'bbbb0051-0000-0000-0000-000000000001';

UPDATE public.group_members
   SET status = 'archived', archived_at = '2026-09-30 12:00:00+00', restored_at = NULL
 WHERE group_id = 'bbbb0051-0000-0000-0000-000000000001'
   AND status = 'active';

-- 6a. O UPDATE dos membros ESTOURA. O primeiro UPDATE (do grupo) ja rodou; a
--     transacao da funcao tem de levar os dois embora. Era isto que a rota --
--     duas chamadas PostgREST, duas transacoes -- nao tinha como garantir.
CREATE FUNCTION pg_temp.sabota_membro() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sabotagem: o UPDATE dos membros falhou' USING ERRCODE = 'io_error';
END $$;

CREATE TRIGGER trg_sabota_membro
  BEFORE UPDATE ON public.group_members
  FOR EACH ROW WHEN (NEW.status = 'active')
  EXECUTE FUNCTION pg_temp.sabota_membro();

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0051-0000-0000-0000-00000000000a';

SELECT pg_temp.recusa(
  '6a: membros estourando derruba a restauracao inteira',
  $cmd$SELECT * FROM public.restore_archived_group('bbbb0051-0000-0000-0000-000000000001')$cmd$,
  '58030');  -- io_error, o SQLSTATE da sabotagem

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

SELECT pg_temp.expect(
  '6a: o grupo NAO ficou ativo -- nada do primeiro UPDATE sobrou',
  (SELECT is_active::TEXT || ' / ' || coalesce(restored_at::TEXT, 'null')
     FROM public.expense_groups WHERE id = 'bbbb0051-0000-0000-0000-000000000001'),
  'false / null');

DROP TRIGGER trg_sabota_membro ON public.group_members;

-- 6b. O jeito SILENCIOSO de falhar, que e o da propria HMO-203: o UPDATE dos
--     membros "passa" e nao grava nada (BEFORE ... RETURN NULL descarta a
--     linha). Nenhum erro, nenhum SQLSTATE -- e `GET DIAGNOSTICS` conta 0.
--     Quem tem de pegar isso e a conferencia de invariante da funcao, nao a
--     transacao: o grupo ficaria ativo com dois membros arquivados, e as telas
--     o mostrariam vazio.
CREATE FUNCTION pg_temp.engole_membro() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RETURN NULL;   -- descarta a escrita, em silencio
END $$;

CREATE TRIGGER trg_engole_membro
  BEFORE UPDATE ON public.group_members
  FOR EACH ROW WHEN (NEW.status = 'active')
  EXECUTE FUNCTION pg_temp.engole_membro();

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0051-0000-0000-0000-00000000000a';

SELECT pg_temp.recusa(
  '6b: membros nao gravando em silencio tambem derruba a restauracao',
  $cmd$SELECT * FROM public.restore_archived_group('bbbb0051-0000-0000-0000-000000000001')$cmd$,
  '22000');  -- data_exception, o SQLSTATE da conferencia da propria funcao

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

SELECT pg_temp.expect(
  '6b: o grupo continua arquivado, e dizendo que continua',
  (SELECT is_active::TEXT || ' / ' ||
          (SELECT string_agg(DISTINCT gm.status, ',' ORDER BY gm.status)
             FROM public.group_members gm WHERE gm.group_id = g.id)
     FROM public.expense_groups g
    WHERE g.id = 'bbbb0051-0000-0000-0000-000000000001'),
  'false / archived,removed');

DROP TRIGGER trg_engole_membro ON public.group_members;

-- 6c. O MESMO SILENCIO, AGORA NA LINHA DO GRUPO -- que e literalmente a
--     HMO-203: o UPDATE em `expense_groups` "passa" e nao grava nada. Em
--     producao quem engolia era a RLS; aqui e um trigger, porque a funcao e
--     SECURITY DEFINER e a RLS nao a alcanca mais. O mecanismo e outro, o
--     sintoma e o mesmo, e e esse sintoma que a conferencia de leitura da
--     funcao tem de pegar -- senao ela devolve "restaurado com sucesso" sobre
--     uma linha que nao mudou, exatamente como a rota antiga.
CREATE FUNCTION pg_temp.engole_grupo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RETURN NULL;   -- descarta a escrita, em silencio
END $$;

CREATE TRIGGER trg_engole_grupo
  BEFORE UPDATE ON public.expense_groups
  FOR EACH ROW WHEN (NEW.is_active)
  EXECUTE FUNCTION pg_temp.engole_grupo();

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0051-0000-0000-0000-00000000000a';

SELECT pg_temp.recusa(
  '6c: o UPDATE do grupo engolido em silencio NAO sai como sucesso',
  $cmd$SELECT * FROM public.restore_archived_group('bbbb0051-0000-0000-0000-000000000001')$cmd$,
  '22000');  -- data_exception, a conferencia que LE A LINHA DE VOLTA

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

SELECT pg_temp.expect(
  '6c: e os membros tambem voltaram atras -- nenhum ficou ativo em grupo inativo',
  (SELECT is_active::TEXT || ' / ' ||
          (SELECT string_agg(DISTINCT gm.status, ',' ORDER BY gm.status)
             FROM public.group_members gm WHERE gm.group_id = g.id)
     FROM public.expense_groups g
    WHERE g.id = 'bbbb0051-0000-0000-0000-000000000001'),
  'false / archived,removed');

DROP TRIGGER trg_engole_grupo ON public.expense_groups;

-- =====================================================
-- 7. AS RECUSAS, CADA UMA COM O SEU SQLSTATE
-- =====================================================
-- Os SQLSTATE sao o contrato com a rota, que os traduz em 403/404/400/401. Um
-- codigo trocado aqui nao e detalhe: a rota responderia o status errado, e
-- "voce nao e admin" para um admin manda ele cacar o problema errado.
--
-- P0002, E NAO 02000. `USING ERRCODE = 'no_data_found'` dentro de plpgsql
-- resolve para **P0002** (a condicao homonima do plpgsql), nao para o 02000 do
-- SQL padrao -- os dois tem o mesmo nome e numeros diferentes. Medido aqui: a
-- primeira versao deste arquivo exigia 02000 e reprovou. Vale escrever porque e
-- o codigo que a rota compara: um `=== "02000"` nunca casaria, e todo "grupo
-- nao encontrado" cairia no ramo generico de 500.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0051-0000-0000-0000-00000000000b';

SELECT pg_temp.recusa(
  'membro comum do grupo nao restaura (42501)',
  $cmd$SELECT * FROM public.restore_archived_group('bbbb0051-0000-0000-0000-000000000003')$cmd$,
  '42501');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0051-0000-0000-0000-00000000000f';

-- Mesma resposta de grupo inexistente, de proposito: senao a rota viraria um
-- detector de grupos para quem adivinha UUID.
SELECT pg_temp.recusa(
  'quem nunca foi do grupo nao restaura (P0002)',
  $cmd$SELECT * FROM public.restore_archived_group('bbbb0051-0000-0000-0000-000000000003')$cmd$,
  'P0002');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0051-0000-0000-0000-00000000000d';

-- O ex-membro: 'removed' NAO esta na lista da autorizacao. "Ja foi do grupo"
-- nao basta -- se bastasse, quem foi removido desarquivaria o grupo para
-- reentrar nele.
SELECT pg_temp.recusa(
  'ex-membro (removed) nao restaura (P0002)',
  $cmd$SELECT * FROM public.restore_archived_group('bbbb0051-0000-0000-0000-000000000001')$cmd$,
  'P0002');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaa0051-0000-0000-0000-00000000000a';

-- Grupo ja ativo tem codigo PROPRIO: a rota responde 400 "ja esta ativo", e
-- confundi-lo com 404 faria a tela dizer que o grupo nao existe.
SELECT pg_temp.recusa(
  'grupo que ja esta ativo recusa com PDG01',
  $cmd$SELECT * FROM public.restore_archived_group('bbbb0051-0000-0000-0000-000000000002')$cmd$,
  'PDG01');

SELECT pg_temp.recusa(
  'grupo inexistente recusa com P0002',
  $cmd$SELECT * FROM public.restore_archived_group('bbbb0051-0000-0000-0000-0000000000ff')$cmd$,
  'P0002');

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- Sem claim nenhum: `auth.uid()` e NULL. Isto NAO pode cair no caminho de
-- autorizacao e sair restaurando -- um cron ou um service_role que chamasse a
-- funcao sem identidade gravaria `restored_by = NULL`.
SET LOCAL ROLE authenticated;

SELECT pg_temp.recusa(
  'sem autenticacao recusa com 28000',
  $cmd$SELECT * FROM public.restore_archived_group('bbbb0051-0000-0000-0000-000000000003')$cmd$,
  '28000');

RESET ROLE;

-- =====================================================
-- 8. ACL
-- =====================================================
SELECT pg_temp.expect(
  'authenticated executa a funcao',
  has_function_privilege('authenticated',
    to_regprocedure('public.restore_archived_group(uuid)'), 'EXECUTE')::TEXT,
  'true');

-- Sem o REVOKE a funcao nasceria com EXECUTE para PUBLIC. `auth.uid()` e NULL
-- para anon, entao ela levantaria 28000 -- mas um caminho SECURITY DEFINER
-- alcancavel sem login nao precisa existir.
SELECT pg_temp.expect(
  'anon nao executa a funcao',
  has_function_privilege('anon',
    to_regprocedure('public.restore_archived_group(uuid)'), 'EXECUTE')::TEXT,
  'false');

SELECT pg_temp.expect(
  'a funcao e SECURITY DEFINER com search_path fixo',
  (SELECT prosecdef::TEXT || ' / ' ||
          (proconfig IS NOT NULL)::TEXT
     FROM pg_proc WHERE oid = to_regprocedure('public.restore_archived_group(uuid)')),
  'true / true');

ROLLBACK;
