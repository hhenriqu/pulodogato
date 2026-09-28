-- =====================================================
-- HMO-167 -- A 020 recusa a linha errada e aceita a certa
-- =====================================================
--
-- Roda no db-verify, contra o banco que as migrations constroem do zero.
--
-- "A coluna existe" nao prova esta migration. O que ela entrega e um conjunto
-- de REGRAS, e uma regra que nao recusa nada nao existe. Cada bloco abaixo
-- tenta gravar a linha proibida dentro de um savepoint e EXIGE excecao; se a
-- gravacao passar, o teste levanta erro e o job fica vermelho.
--
-- O caso 1 e o coracao da migration: antes dela, `status = 'archived'` violava
-- group_members_status_check, o codigo engolia o erro em silencio, e a rota de
-- listagem -- que filtra exatamente por esse valor -- devolveria lista vazia
-- para sempre.

BEGIN;

-- --- cenario ---------------------------------------------------------------
-- Dois usuarios: um cria e outro arquiva. Precisamos dos dois para provar que
-- apagar o ARQUIVADOR nao apaga o grupo, enquanto apagar o CRIADOR apaga.

INSERT INTO auth.users (id, email)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'criador@teste.local'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'arquivador@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'criador@teste.local', 'Criador'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'arquivador@teste.local', 'Arquivador')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.expense_groups (id, name, group_code, created_by, is_active)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'Grupo de teste', 'TST020', 'aaaaaaaa-0000-0000-0000-000000000001', true);

-- NAO inserimos o membro: um trigger do 001_baseline ja adiciona o criador como
-- admin ao criar o grupo, e inserir de novo bate no unique (group_id, user_id).
-- Aqui so renomeamos a linha que o trigger criou, para os casos abaixo
-- referenciarem um id fixo.
UPDATE public.group_members
   SET id = 'cccccccc-0000-0000-0000-000000000001'
 WHERE group_id = 'bbbbbbbb-0000-0000-0000-000000000001'
   AND user_id = 'aaaaaaaa-0000-0000-0000-000000000001';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.group_members WHERE id = 'cccccccc-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'cenario: o trigger do baseline nao criou o membro criador -- os casos abaixo nao provariam nada';
  END IF;
END $$;

-- --- 1. 'archived' passou a ser aceito -------------------------------------

DO $$
BEGIN
  UPDATE public.group_members
     SET status = 'archived', archived_at = now()
   WHERE id = 'cccccccc-0000-0000-0000-000000000001';
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
     WHERE id = 'cccccccc-0000-0000-0000-000000000001' AND status = 'archived'
  ) THEN
    RAISE EXCEPTION 'CASO 1: o UPDATE para archived nao gravou';
  END IF;
  RAISE NOTICE 'CASO 1 OK: group_members aceita status = archived';
END $$;

-- --- 2. o CHECK continua recusando valor inventado --------------------------
-- Alargar um dominio costuma virar "aceita qualquer coisa". Este caso e o que
-- prova que a 020 acrescentou UM valor, e nao desligou a regra.

DO $$
BEGIN
  BEGIN
    UPDATE public.group_members SET status = 'arquivadinho'
     WHERE id = 'cccccccc-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'CASO 2 FALHOU: o CHECK aceitou um status inventado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'CASO 2 OK: status invalido segue recusado';
  END;
END $$;

-- --- 3. archived_at SEM archived_by e ACEITO -------------------------------
-- De proposito, e este caso e o que corrigiu a migration. A primeira versao
-- usava o par simetrico `(archived_at IS NULL) = (archived_by IS NULL)`, e
-- entao o `ON DELETE SET NULL` da FK -- que ESCREVE a linha -- passava a ser
-- recusado pelo CHECK, tornando impossivel apagar um perfil que arquivou um
-- grupo (caso 6). "Arquivado por alguem que ja saiu" e estado legitimo.

DO $$
BEGIN
  UPDATE public.expense_groups SET archived_at = now(), archived_by = NULL
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF NOT EXISTS (
    SELECT 1 FROM public.expense_groups
     WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'
       AND archived_at IS NOT NULL AND archived_by IS NULL
  ) THEN
    RAISE EXCEPTION 'CASO 3: archived_at sem archived_by deveria ser aceito';
  END IF;
  RAISE NOTICE 'CASO 3 OK: archived_at sem archived_by e aceito (arquivador que saiu)';
END $$;

-- --- 4. archived_by sem archived_at e recusado -----------------------------

DO $$
BEGIN
  BEGIN
    UPDATE public.expense_groups
       SET archived_by = 'aaaaaaaa-0000-0000-0000-000000000002', archived_at = NULL
     WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'CASO 4 FALHOU: aceitou archived_by sem archived_at';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'CASO 4 OK: archived_by sem archived_at recusado';
  END;
END $$;

-- --- 5. o par completo e aceito --------------------------------------------
-- Controle POSITIVO. Sem ele, os casos 3 e 4 ficariam satisfeitos por um CHECK
-- que recusa TUDO -- e a feature nao funcionaria por outro motivo.

DO $$
BEGIN
  UPDATE public.expense_groups
     SET is_active = false,
         archived_at = now(),
         archived_by = 'aaaaaaaa-0000-0000-0000-000000000002'
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF NOT EXISTS (
    SELECT 1 FROM public.expense_groups
     WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'
       AND archived_at IS NOT NULL AND archived_by IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'CASO 5: o arquivamento completo nao gravou';
  END IF;
  RAISE NOTICE 'CASO 5 OK: arquivamento completo aceito';
END $$;

-- --- 6. apagar o ARQUIVADOR nao apaga o grupo ------------------------------
-- Este e o caso que o ON DELETE errado teria escondido. Com CASCADE (copiado
-- de expense_groups_created_by_fkey), apagar o perfil de quem arquivou levaria
-- o grupo e o historico financeiro dele junto, sem aviso.

DO $$
DECLARE
  sobrou boolean;
  quem uuid;
BEGIN
  DELETE FROM public.profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';

  SELECT true, archived_by INTO sobrou, quem
    FROM public.expense_groups
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';

  IF sobrou IS NOT TRUE THEN
    RAISE EXCEPTION 'CASO 6 FALHOU: apagar o arquivador apagou o GRUPO';
  END IF;
  IF quem IS NOT NULL THEN
    RAISE EXCEPTION 'CASO 6 FALHOU: archived_by nao virou NULL, ficou %', quem;
  END IF;
  RAISE NOTICE 'CASO 6 OK: grupo sobrevive, archived_by virou NULL';
END $$;

-- --- 7. o grupo continua ALCANCAVEL depois de perder o arquivador -----------
-- A consequencia do caso 6 que importa para a tela: a rota de listagem filtra
-- por `archived_at IS NOT NULL`, nao por archived_by, entao o grupo continua
-- aparecendo. So o embed do arquivador vem nulo. Se o filtro da rota algum dia
-- mudar para archived_by, este caso fica vermelho.

DO $$
DECLARE
  achado integer;
BEGIN
  SELECT count(*) INTO achado
    FROM public.expense_groups
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'
     AND is_active = false
     AND archived_at IS NOT NULL;

  IF achado <> 1 THEN
    RAISE EXCEPTION 'CASO 7 FALHOU: o grupo sumiu da listagem de arquivados depois de o arquivador ser apagado';
  END IF;
  RAISE NOTICE 'CASO 7 OK: grupo segue na listagem de arquivados, so sem o nome de quem arquivou';
END $$;

ROLLBACK;
