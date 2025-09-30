-- =====================================================
-- APLICAR EM SEQUÊNCIA: Correção da recursão RLS
-- Execute estes comandos UM POR VEZ no Supabase SQL Editor
-- =====================================================

-- PASSO 1: Verificar o problema atual
SELECT 
    'VERIFICAÇÃO - Políticas atuais problemáticas:' as status,
    policyname, 
    cmd
FROM pg_policies 
WHERE tablename = 'group_members'
ORDER BY policyname;

-- PASSO 2: Remover TODAS as políticas problemáticas
DROP POLICY IF EXISTS "Members can view other group members" ON group_members;
DROP POLICY IF EXISTS "Admins can manage group members" ON group_members;
DROP POLICY IF EXISTS "Membros veem outros membros do grupo" ON group_members;
DROP POLICY IF EXISTS "Admins podem gerenciar membros" ON group_members;
DROP POLICY IF EXISTS "Usuários veem seus próprios memberships" ON group_members;
DROP POLICY IF EXISTS "Membros veem outros membros do mesmo grupo" ON group_members;
DROP POLICY IF EXISTS "user_own_memberships" ON group_members;
DROP POLICY IF EXISTS "view_group_members" ON group_members;
DROP POLICY IF EXISTS "admin_manage_members" ON group_members;

-- PASSO 3: Temporariamente desabilitar RLS
ALTER TABLE group_members DISABLE ROW LEVEL SECURITY;

-- PASSO 4: Reabilitar RLS
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

-- PASSO 5: Criar política temporária simples (sem recursão)
CREATE POLICY "temp_authenticated_access" 
    ON group_members FOR ALL 
    USING (auth.uid() IS NOT NULL);

-- PASSO 6: Verificar se funcionou
SELECT 'TESTE: Verificar se conseguimos buscar membros agora' as status;

-- PASSO 7: Testar uma consulta simples
SELECT COUNT(*) as total_members FROM group_members WHERE status = 'active';