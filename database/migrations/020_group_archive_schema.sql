-- 020_group_archive_schema.sql
--
-- HMO-167: a feature "grupos arquivados" foi escrita contra um schema que
-- nunca existiu. Esta migration cria o schema que o codigo ja pede.
--
-- O que o codigo pede, e que nao existe:
--
--   expense_groups.archived_at   -- GET /api/expense-groups/archived filtra por ela
--   expense_groups.archived_by   -- e embute profiles por FK
--   expense_groups.restored_at   -- POST .../[groupId]/restore grava
--   expense_groups.restored_by   -- idem
--   group_members.archived_at
--   group_members.restored_at
--
-- As duas ultimas NAO estavam no levantamento original da issue. Elas escapam
-- do check-column-drift porque vivem dentro do objeto de um `.update({...})`, e
-- aquele guard le `.select()` e os filtros -- nao le a carga de escrita. Sem
-- elas, `POST /api/expense-groups/[groupId]/restore` responderia 500 do mesmo
-- jeito que a rota de listagem.
--
-- E o achado que muda o desenho: `group_members_status_check` so aceita
-- 'active', 'inactive', 'pending' e 'removed'. O codigo grava
-- `status = 'archived'` ao arquivar (app/api/expense-groups/[groupId]/route.ts),
-- entao essa escrita viola o CHECK -- e o erro e capturado e apenas logado
-- ("Nao falhar se nao conseguir arquivar membros"), enquanto a rota devolve
-- `success: true` e um `archived_at` que nunca foi gravado.
--
-- O efeito pratico e que SO criar as colunas nao entregaria a tela: as duas
-- consultas da rota de listagem filtram `status = 'archived'`, nenhuma linha
-- poderia ter esse valor, e a tela abriria vazia para sempre -- com cara de
-- "voce nao tem grupos arquivados", que e a mentira mais convincente que existe.
-- Por isso o CHECK entra aqui junto.
--
-- Sobre dados existentes: `expense_groups` e `group_members` estao com ZERO
-- linhas em producao (conferido em 2026-09-28 pela credencial de leitura), e as
-- colunas nascem nulas. Nao ha backfill a fazer e nao ha linha que possa
-- reprovar o CHECK novo -- ele so ACRESCENTA um valor aceito.
--
-- Idempotente: pode rodar duas vezes seguidas sem erro.
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Colunas de arquivamento e restauracao
-- ---------------------------------------------------------------------------

ALTER TABLE public.expense_groups
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS restored_at timestamptz,
  ADD COLUMN IF NOT EXISTS restored_by uuid;

ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS restored_at timestamptz;

COMMENT ON COLUMN public.expense_groups.archived_at IS
  'Quando o grupo foi arquivado. NULL = nunca arquivado. A rota de listagem de arquivados exige NOT NULL aqui.';
COMMENT ON COLUMN public.expense_groups.archived_by IS
  'Quem arquivou. ON DELETE SET NULL: apagar o perfil de quem arquivou nao pode apagar o grupo.';

-- ---------------------------------------------------------------------------
-- 2. As FKs -- e o NOME importa
-- ---------------------------------------------------------------------------
--
-- A rota embute `archiver:profiles!expense_groups_archived_by_fkey(...)`. O
-- PostgREST resolve o embed pelo NOME da constraint, entao um nome diferente
-- aqui quebra a rota mesmo com a coluna e a FK corretas.
--
-- ON DELETE SET NULL, e nao CASCADE. `expense_groups_created_by_fkey` cascateia
-- porque grupo sem criador nao faz sentido; arquivador e outra coisa -- apagar
-- o perfil de quem arquivou nao pode levar o grupo (e o historico financeiro
-- dele) junto. O mesmo para restored_by.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expense_groups_archived_by_fkey'
  ) THEN
    ALTER TABLE public.expense_groups
      ADD CONSTRAINT expense_groups_archived_by_fkey
      FOREIGN KEY (archived_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expense_groups_restored_by_fkey'
  ) THEN
    ALTER TABLE public.expense_groups
      ADD CONSTRAINT expense_groups_restored_by_fkey
      FOREIGN KEY (restored_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. O CHECK que impedia a feature de existir
-- ---------------------------------------------------------------------------
--
-- Acrescenta 'archived' aos valores aceitos. Os quatro que ja existiam
-- continuam aceitos -- nenhuma linha de hoje deixa de passar.

ALTER TABLE public.group_members
  DROP CONSTRAINT IF EXISTS group_members_status_check;

ALTER TABLE public.group_members
  ADD CONSTRAINT group_members_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'pending'::text, 'removed'::text, 'archived'::text]));

-- ---------------------------------------------------------------------------
-- 4. Coerencia entre o par de colunas -- em UMA direcao so
-- ---------------------------------------------------------------------------
--
-- O estado que precisa ser proibido e `archived_by` preenchido com
-- `archived_at` NULL: ali o grupo desaparece das DUAS telas -- da ativa porque
-- is_active = false, e da de arquivados porque a rota filtra por archived_at
-- NOT NULL. Ninguem recebe erro; o grupo simplesmente deixa de ser alcancavel.
--
-- A direcao contraria (`archived_at` preenchido, `archived_by` NULL) tem que
-- ser PERMITIDA, e a primeira versao desta migration errava exatamente isso.
-- Ela usava `(archived_at IS NULL) = (archived_by IS NULL)`, o par simetrico, e
-- o teste 020_group_archive_test.sql reprovou: o `ON DELETE SET NULL` da FK
-- ESCREVE a linha, o CHECK e avaliado nessa escrita, e o DELETE do perfil
-- falhava com check_violation. O efeito seria apagar um perfil que ja arquivou
-- um grupo virar impossivel -- o que hoje nenhuma rota faz (o plano de
-- lib/account-reset.ts nao inclui profiles), mas apagar um usuario pelo painel
-- do Supabase cascateia para profiles e cairia aqui.
--
-- Entao: "arquivado por alguem que ja saiu" e um estado legitimo. A tela tem
-- que aguentar o embed do arquivador vindo nulo.

ALTER TABLE public.expense_groups
  DROP CONSTRAINT IF EXISTS expense_groups_archived_par_check;

ALTER TABLE public.expense_groups
  ADD CONSTRAINT expense_groups_archived_par_check
  CHECK (archived_by IS NULL OR archived_at IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 5. Indice da listagem
-- ---------------------------------------------------------------------------
--
-- Indice PARCIAL de proposito: arquivado e a minoria das linhas, e nenhum
-- upsert usa essas colunas como arbitro de ON CONFLICT -- que e o caso em que
-- indice parcial nao serve (o supabase-js nao manda o predicado).

CREATE INDEX IF NOT EXISTS idx_expense_groups_arquivados
  ON public.expense_groups (archived_at DESC)
  WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_group_members_arquivados
  ON public.group_members (group_id, user_id)
  WHERE status = 'archived';

COMMIT;
