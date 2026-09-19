-- =====================================================
-- PULODOGATO - RLS LOCKDOWN
-- =====================================================
-- Migration: 002_rls_lockdown
-- Gerado em: 2026-09-18
--
-- POR QUE ESTE ARQUIVO EXISTE
-- ---------------------------
-- Auditoria de 2026-09-18 contra producao (odxqjvtxsioksguuevqm), usando
-- SOMENTE a chave anon publica e SEM autenticar:
--
--   profiles                2 linhas lidas   (nome, telefone, email, bio)
--   financial_accounts      8 linhas lidas   (banco, limite, saldo)
--   financial_transactions  4 linhas lidas   (valor, data, descricao)
--   expense_groups          6 linhas lidas
--   group_members           7 linhas lidas
--   group_expense_splits    5 linhas lidas
--   group_transactions      3 linhas lidas
--
-- E um INSERT anonimo em `profiles` retornou 23505 (duplicate key), nao 42501
-- (RLS violation) - ou seja, a escrita tambem passa. A chave anon vai embutida
-- no bundle JS publico, entao isso equivale a um banco aberto na internet.
--
-- Este script fecha tudo por padrao e reabre apenas o necessario.
--
-- ATENCAO - TESTAR ANTES DE RODAR EM PRODUCAO:
-- As politicas abaixo foram derivadas dos padroes de acesso do codigo, nao das
-- politicas reais (que nao foi possivel ler sem credencial de Postgres).
-- Rode primeiro num projeto Supabase limpo com 001_baseline.sql, exercite o
-- app, e so depois aplique aqui. Ver database/README.md.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 1: FUNCOES AUXILIARES
-- =====================================================
-- SECURITY DEFINER de proposito: sem isso, uma policy de group_members que
-- consulta group_members entra em recursao infinita (erro 42P17).

CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_admin(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id
      AND user_id = auth.uid()
      AND role = 'admin'
      AND status = 'active'
  );
$$;

-- Dono da linha de group_members (usado por splits/proporcoes)
CREATE OR REPLACE FUNCTION public.owns_group_member(p_member_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE id = p_member_id AND user_id = auth.uid()
  );
$$;

-- Convite pendente e valido endereçado a quem esta chamando
CREATE OR REPLACE FUNCTION public.has_pending_invitation(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_invitations
    WHERE group_id = p_group_id
      AND invited_user_id = auth.uid()
      AND status = 'pending'
      AND (expires_at IS NULL OR expires_at > NOW())
  );
$$;

-- Entrar em grupo pelo codigo de 6 caracteres.
--
-- Precisa ser SECURITY DEFINER: a checagem de autorizacao aqui e "conhece o
-- group_code", e isso nao da pra expressar numa policy de RLS - o INSERT em
-- group_members so carrega o group_id, nao o codigo. Sem esta funcao, a policy
-- teria que liberar auto-insercao em qualquer grupo (bastaria descobrir o UUID
-- para virar membro e passar a ler as transacoes do grupo).
-- Nota: a busca do grupo pelo codigo TAMBEM precisa estar aqui dentro. A policy
-- de SELECT de expense_groups so mostra grupos em que voce ja esta - quem esta
-- entrando ainda nao esta, entao um SELECT pelo codigo feito pelo app voltaria
-- vazio. Grupo publico entra como 'active'; privado entra como 'pending', que e
-- a regra que app/api/expense-groups/join/route.ts ja aplicava.
CREATE OR REPLACE FUNCTION public.join_group_by_code(p_group_code TEXT)
RETURNS TABLE (group_id UUID, group_name TEXT, member_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- use_column: as colunas de saida (group_id, ...) tem o mesmo nome de colunas
-- de group_members. Sem esta diretiva, o ON CONFLICT abaixo nao compila
-- ("column reference group_id is ambiguous").
#variable_conflict use_column
DECLARE
  v_group   public.expense_groups%ROWTYPE;
  v_status  TEXT;
  v_current TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_group
  FROM public.expense_groups
  WHERE group_code = UPPER(p_group_code) AND is_active = TRUE;

  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'grupo nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;

  -- alias obrigatorio: sem ele, `group_id` colide com a coluna de saida da
  -- funcao (RETURNS TABLE) e o Postgres recusa com "column reference ambiguous".
  SELECT gm.status INTO v_current
  FROM public.group_members gm
  WHERE gm.group_id = v_group.id
    AND gm.user_id = auth.uid();

  IF v_current IN ('active', 'pending') THEN
    RAISE EXCEPTION 'ja e membro (%)', v_current USING ERRCODE = 'unique_violation';
  END IF;

  v_status := CASE WHEN v_group.group_type = 'public' THEN 'active' ELSE 'pending' END;

  INSERT INTO public.group_members AS gm (group_id, user_id, role, status)
  VALUES (v_group.id, auth.uid(), 'member', v_status)
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET status = v_status, updated_at = NOW();

  RETURN QUERY SELECT v_group.id, v_group.name, v_status;
END $$;

REVOKE ALL ON FUNCTION public.join_group_by_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_group_by_code(TEXT) TO authenticated;

-- =====================================================
-- SECAO 2: REVOGAR PRIVILEGIOS DE TABELA DO ANON
-- =====================================================
-- RLS so protege se a role tambem nao tiver privilegio amplo. Hoje `anon`
-- tem SELECT/INSERT/UPDATE/DELETE nas tabelas de dados.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Tabelas de referencia continuam legiveis sem login (o app usa na tela de
-- cadastro de transacao antes de resolver a sessao).
GRANT SELECT ON public.financial_services TO anon;
GRANT SELECT ON public.transaction_categories TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- =====================================================
-- SECAO 3: HABILITAR RLS EM TODAS AS TABELAS
-- =====================================================
ALTER TABLE public.profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_services        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_groups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_transactions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_expense_splits      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_member_proportions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_invitations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_splits            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_installments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_balances             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_usage_limits         ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- SECAO 4: POLITICAS
-- =====================================================

-- ---------- profiles ----------
DROP POLICY IF EXISTS profiles_select_own_or_public ON public.profiles;
CREATE POLICY profiles_select_own_or_public ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_public = TRUE);

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Sem policy de DELETE: perfil some junto com auth.users (ON DELETE CASCADE).

-- ---------- tabelas de referencia (somente leitura) ----------
DROP POLICY IF EXISTS financial_services_read ON public.financial_services;
CREATE POLICY financial_services_read ON public.financial_services
  FOR SELECT TO anon, authenticated USING (is_active = TRUE);

DROP POLICY IF EXISTS transaction_categories_read ON public.transaction_categories;
CREATE POLICY transaction_categories_read ON public.transaction_categories
  FOR SELECT TO anon, authenticated USING (is_active = TRUE);

-- ---------- financial_accounts ----------
DROP POLICY IF EXISTS financial_accounts_own ON public.financial_accounts;
CREATE POLICY financial_accounts_own ON public.financial_accounts
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------- financial_transactions ----------
-- Dono sempre; membros do grupo so leem o que foi compartilhado no grupo.
DROP POLICY IF EXISTS financial_transactions_select ON public.financial_transactions;
CREATE POLICY financial_transactions_select ON public.financial_transactions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (group_id IS NOT NULL AND public.is_group_member(group_id))
  );

DROP POLICY IF EXISTS financial_transactions_write ON public.financial_transactions;
CREATE POLICY financial_transactions_write ON public.financial_transactions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS financial_transactions_update ON public.financial_transactions;
CREATE POLICY financial_transactions_update ON public.financial_transactions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS financial_transactions_delete ON public.financial_transactions;
CREATE POLICY financial_transactions_delete ON public.financial_transactions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ---------- transaction_installments ----------
DROP POLICY IF EXISTS transaction_installments_own ON public.transaction_installments;
CREATE POLICY transaction_installments_own ON public.transaction_installments
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------- expense_groups ----------
DROP POLICY IF EXISTS expense_groups_select ON public.expense_groups;
CREATE POLICY expense_groups_select ON public.expense_groups
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.is_group_member(id));

DROP POLICY IF EXISTS expense_groups_insert ON public.expense_groups;
CREATE POLICY expense_groups_insert ON public.expense_groups
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS expense_groups_update ON public.expense_groups;
CREATE POLICY expense_groups_update ON public.expense_groups
  FOR UPDATE TO authenticated
  USING (public.is_group_admin(id)) WITH CHECK (public.is_group_admin(id));

DROP POLICY IF EXISTS expense_groups_delete ON public.expense_groups;
CREATE POLICY expense_groups_delete ON public.expense_groups
  FOR DELETE TO authenticated USING (created_by = auth.uid());

-- ---------- group_members ----------
DROP POLICY IF EXISTS group_members_select ON public.group_members;
CREATE POLICY group_members_select ON public.group_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_group_member(group_id));

-- Entrar num grupo exige convite pendente, ou ser admin do grupo. Entrar pelo
-- codigo passa por public.join_group_by_code(), nao por INSERT direto.
DROP POLICY IF EXISTS group_members_insert ON public.group_members;
CREATE POLICY group_members_insert ON public.group_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_group_admin(group_id)
    OR (user_id = auth.uid() AND public.has_pending_invitation(group_id))
  );

DROP POLICY IF EXISTS group_members_update ON public.group_members;
CREATE POLICY group_members_update ON public.group_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_group_admin(group_id))
  WITH CHECK (user_id = auth.uid() OR public.is_group_admin(group_id));

DROP POLICY IF EXISTS group_members_delete ON public.group_members;
CREATE POLICY group_members_delete ON public.group_members
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_group_admin(group_id));

-- ---------- group_transactions ----------
DROP POLICY IF EXISTS group_transactions_select ON public.group_transactions;
CREATE POLICY group_transactions_select ON public.group_transactions
  FOR SELECT TO authenticated USING (public.is_group_member(group_id));

DROP POLICY IF EXISTS group_transactions_insert ON public.group_transactions;
CREATE POLICY group_transactions_insert ON public.group_transactions
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.is_group_member(group_id));

DROP POLICY IF EXISTS group_transactions_modify ON public.group_transactions;
CREATE POLICY group_transactions_modify ON public.group_transactions
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.is_group_admin(group_id))
  WITH CHECK (created_by = auth.uid() OR public.is_group_admin(group_id));

DROP POLICY IF EXISTS group_transactions_delete ON public.group_transactions;
CREATE POLICY group_transactions_delete ON public.group_transactions
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.is_group_admin(group_id));

-- ---------- group_expense_splits ----------
DROP POLICY IF EXISTS group_expense_splits_select ON public.group_expense_splits;
CREATE POLICY group_expense_splits_select ON public.group_expense_splits
  FOR SELECT TO authenticated
  USING (
    public.owns_group_member(member_id)
    OR EXISTS (
      SELECT 1 FROM public.group_transactions gt
      WHERE gt.id = group_transaction_id AND public.is_group_member(gt.group_id)
    )
  );

DROP POLICY IF EXISTS group_expense_splits_write ON public.group_expense_splits;
CREATE POLICY group_expense_splits_write ON public.group_expense_splits
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.group_transactions gt
    WHERE gt.id = group_transaction_id AND public.is_group_member(gt.group_id)
  ));

-- Cada membro aprova/comenta a propria divisao; admin do grupo ajusta qualquer uma.
DROP POLICY IF EXISTS group_expense_splits_update ON public.group_expense_splits;
CREATE POLICY group_expense_splits_update ON public.group_expense_splits
  FOR UPDATE TO authenticated
  USING (
    public.owns_group_member(member_id)
    OR EXISTS (
      SELECT 1 FROM public.group_transactions gt
      WHERE gt.id = group_transaction_id AND public.is_group_admin(gt.group_id)
    )
  )
  WITH CHECK (
    public.owns_group_member(member_id)
    OR EXISTS (
      SELECT 1 FROM public.group_transactions gt
      WHERE gt.id = group_transaction_id AND public.is_group_admin(gt.group_id)
    )
  );

DROP POLICY IF EXISTS group_expense_splits_delete ON public.group_expense_splits;
CREATE POLICY group_expense_splits_delete ON public.group_expense_splits
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.group_transactions gt
    WHERE gt.id = group_transaction_id AND public.is_group_admin(gt.group_id)
  ));

-- ---------- group_member_proportions ----------
DROP POLICY IF EXISTS group_member_proportions_select ON public.group_member_proportions;
CREATE POLICY group_member_proportions_select ON public.group_member_proportions
  FOR SELECT TO authenticated USING (public.is_group_member(group_id));

DROP POLICY IF EXISTS group_member_proportions_write ON public.group_member_proportions;
CREATE POLICY group_member_proportions_write ON public.group_member_proportions
  FOR ALL TO authenticated
  USING (public.is_group_admin(group_id)) WITH CHECK (public.is_group_admin(group_id));

-- ---------- group_invitations ----------
-- Convidado ve o proprio convite; admin do grupo ve e gerencia os do grupo.
DROP POLICY IF EXISTS group_invitations_select ON public.group_invitations;
CREATE POLICY group_invitations_select ON public.group_invitations
  FOR SELECT TO authenticated
  USING (
    invited_user_id = auth.uid()
    OR invited_by = auth.uid()
    OR public.is_group_admin(group_id)
  );

DROP POLICY IF EXISTS group_invitations_insert ON public.group_invitations;
CREATE POLICY group_invitations_insert ON public.group_invitations
  FOR INSERT TO authenticated
  WITH CHECK (invited_by = auth.uid() AND public.is_group_admin(group_id));

DROP POLICY IF EXISTS group_invitations_update ON public.group_invitations;
CREATE POLICY group_invitations_update ON public.group_invitations
  FOR UPDATE TO authenticated
  USING (invited_user_id = auth.uid() OR public.is_group_admin(group_id))
  WITH CHECK (invited_user_id = auth.uid() OR public.is_group_admin(group_id));

DROP POLICY IF EXISTS group_invitations_delete ON public.group_invitations;
CREATE POLICY group_invitations_delete ON public.group_invitations
  FOR DELETE TO authenticated USING (public.is_group_admin(group_id));

-- ---------- expense_splits ----------
DROP POLICY IF EXISTS expense_splits_select ON public.expense_splits;
CREATE POLICY expense_splits_select ON public.expense_splits
  FOR SELECT TO authenticated
  USING (
    participant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.financial_transactions ft
      WHERE ft.id = transaction_id AND ft.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS expense_splits_insert ON public.expense_splits;
CREATE POLICY expense_splits_insert ON public.expense_splits
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.financial_transactions ft
    WHERE ft.id = transaction_id AND ft.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS expense_splits_update ON public.expense_splits;
CREATE POLICY expense_splits_update ON public.expense_splits
  FOR UPDATE TO authenticated
  USING (
    participant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.financial_transactions ft
      WHERE ft.id = transaction_id AND ft.user_id = auth.uid()
    )
  )
  WITH CHECK (
    participant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.financial_transactions ft
      WHERE ft.id = transaction_id AND ft.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS expense_splits_delete ON public.expense_splits;
CREATE POLICY expense_splits_delete ON public.expense_splits
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.financial_transactions ft
    WHERE ft.id = transaction_id AND ft.user_id = auth.uid()
  ));

-- ---------- user_balances ----------
-- Saldo e derivado; so leitura pelo app. Recalculo roda com service_role.
DROP POLICY IF EXISTS user_balances_select ON public.user_balances;
CREATE POLICY user_balances_select ON public.user_balances
  FOR SELECT TO authenticated
  USING (creditor_id = auth.uid() OR debtor_id = auth.uid());

-- ---------- user_subscriptions ----------
-- Leitura propria apenas. Alteracao de plano NAO pode sair do cliente.
DROP POLICY IF EXISTS user_subscriptions_select ON public.user_subscriptions;
CREATE POLICY user_subscriptions_select ON public.user_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.user_subscriptions FROM authenticated;

-- ---------- user_usage_limits ----------
DROP POLICY IF EXISTS user_usage_limits_select ON public.user_usage_limits;
CREATE POLICY user_usage_limits_select ON public.user_usage_limits
  FOR SELECT TO authenticated USING (user_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.user_usage_limits FROM authenticated;

COMMIT;

-- =====================================================
-- VERIFICACAO POS-APLICACAO
-- =====================================================
-- 1) Nenhuma tabela pode ficar sem RLS:
--
--   SELECT relname FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
--   -- deve retornar 0 linhas
--
-- 2) Repetir a auditoria anonima (deve dar 0 linhas em tudo, menos nas duas
--    tabelas de referencia):
--
--   node scripts/extract-schema.mjs --audit
-- =====================================================
