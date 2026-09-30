-- 029_pedido_de_entrada_visivel.sql
--
-- HMO-190, segunda volta: "Usuario leticia.macoliver esta dizendo que ja faz
-- parte do grupo mas o grupo nao esta aparecendo para ela."
--
-- Ela nao estava enganada, nem confusa: o app disse isso pra ela, com todas as
-- letras. A 002 fechou a entrada por codigo assim -- grupo privado entra como
-- `pending` -- e a #112 deu ao admin como aprovar. O que ficou faltando e o
-- lado de quem pediu, e sao dois buracos que se somam.
--
-- ===========================================================================
-- BURACO 1: PEDIR DUAS VEZES RESPONDE UMA MENTIRA
-- ===========================================================================
-- `join_group_by_code` recusa com um unico SQLSTATE para dois estados que nao
-- sao a mesma coisa:
--
--     IF v_current IN ('active', 'pending') THEN
--       RAISE EXCEPTION 'ja e membro (%)', v_current USING ERRCODE = 'unique_violation';
--
-- e app/api/expense-groups/join/route.ts traduz 23505 -- os dois -- para
-- "You are already a member of this group".
--
-- Para quem esta `active` isso e verdade e nao machuca: o grupo aparece na
-- lista dela. Para quem esta `pending` e falso em cima de invisivel. O
-- caminho que a Leticia percorreu foi exatamente esse:
--
--   1. digitou o codigo   -> virou `pending`, viu "aguardando aprovacao";
--   2. o grupo nao apareceu (nem podia: veja o buraco 2);
--   3. digitou de novo    -> "voce ja e membro deste grupo";
--   4. foi falar com o dono do grupo dizendo que ja fazia parte.
--
-- O passo 3 e o defeito. Repetir um pedido que continua pendente NAO e um
-- erro -- e a mesma pessoa, no mesmo grupo, pedindo a mesma coisa que ja esta
-- na fila. A resposta certa e repetir o estado, nao inventar um membro. Entao
-- `pending` deixa de levantar excecao e passa a RETORNAR, com
-- member_status = 'pending', que e o que a rota ja sabe apresentar como
-- "aguardando aprovacao". O 23505 fica so para `active`, onde ele e honesto.
--
-- Isso torna a funcao idempotente para o pedido pendente, e de proposito: e a
-- unica leitura que nao produz uma afirmacao falsa em algum dos dois estados.
-- O retorno acontece ANTES do INSERT/ON CONFLICT, entao o pedido original
-- preserva o `updated_at` de quando foi mesmo feito -- pedir de novo nao
-- rejuvenesce a fila do admin.
--
-- `removed` e `inactive` continuam caindo no ON CONFLICT DO UPDATE de antes:
-- quem saiu (ou foi tirado) pode pedir de novo, e ai e um pedido novo mesmo.
--
-- ===========================================================================
-- BURACO 2: DEPOIS DE PEDIR, O APP NAO MOSTRA VESTIGIO NENHUM
-- ===========================================================================
-- Nao e a lista de grupos que esconde o pedido -- e a RLS, e ela esta certa:
--
--     is_group_member(g)      := EXISTS (... AND status = 'active')
--     expense_groups_select   := created_by = auth.uid() OR is_group_member(id)
--
-- Quem esta `pending` nao e membro, entao a linha de `expense_groups` e
-- invisivel para ela. Isso e o que a gente quer: pendente nao pode ler o grupo
-- -- nem as despesas, nem quem mais esta dentro. Afrouxar
-- `expense_groups_select` para incluir pendente resolveria a tela e abriria o
-- conteudo do grupo junto. Nao e o negocio.
--
-- Mas ela PODE ler a propria linha de `group_members` (`group_members_select`
-- ja tem `user_id = auth.uid()`), e essa linha so tem o `group_id`: um UUID,
-- que nao da tela nenhuma. O que falta e o nome do grupo -- e so o nome.
--
-- Dai `my_pending_group_requests()`: SECURITY DEFINER, sem argumento, devolve
-- SO as linhas `pending` do proprio chamador, e de cada grupo devolve apenas
-- id, nome e quando o pedido foi feito. Nao devolve descricao, nem
-- `group_code`, nem membros, nem se o grupo tem despesa. Nao da para passar o
-- grupo de outra pessoa como argumento porque nao ha argumento: o filtro e
-- `user_id = auth.uid()`, dentro da funcao.
--
-- O que ela revela, entao, e o nome de um grupo em que a propria chamadora ja
-- registrou um pedido -- ou seja, um grupo cujo codigo ela ja provou conhecer,
-- porque foi digitando o codigo certo que a linha `pending` nasceu. Nenhuma
-- linha nova fica alcancavel por causa desta funcao.

-- =====================================================
-- SECAO 1: PEDIDO PENDENTE REPETIDO NAO E "JA E MEMBRO"
-- =====================================================
-- Reescrita inteira (CREATE OR REPLACE) porque plpgsql nao tem como alterar um
-- ramo isolado. Fora o bloco de `v_current`, o corpo e o mesmo da 002.

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

  -- Ja e membro de fato: 23505, e a rota responde "voce ja e membro". Verdade,
  -- e verificavel -- o grupo esta na lista dela.
  IF v_current = 'active' THEN
    RAISE EXCEPTION 'ja e membro (%)', v_current USING ERRCODE = 'unique_violation';
  END IF;

  -- Ja pediu e continua na fila: repete o estado em vez de chamar de erro.
  -- Sai ANTES do INSERT de proposito, para nao reescrever `updated_at`: a
  -- ordem da fila do admin e a ordem em que as pessoas pediram, nao a ordem em
  -- que elas voltaram para conferir.
  IF v_current = 'pending' THEN
    RETURN QUERY SELECT v_group.id, v_group.name, 'pending'::TEXT;
    RETURN;
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
-- SECAO 2: A PESSOA CONSEGUE VER QUE TEM UM PEDIDO NA FILA
-- =====================================================
-- Precisa ser DEFINER pelo mesmo motivo da `join_group_by_code`: o nome do
-- grupo esta em `expense_groups`, que a RLS esconde de quem ainda nao e membro
-- ativo. A diferenca e que aqui a autorizacao nao e "conhece o codigo" e sim
-- "ja tem uma linha pending sua neste grupo" -- que e um fato do banco, checado
-- na propria query, e nao algo que o chamador afirma.
--
-- Sem argumento por decisao de seguranca: nao ha nada que o chamador possa
-- passar para apontar a funcao para o grupo de outra pessoa.

CREATE OR REPLACE FUNCTION public.my_pending_group_requests()
RETURNS TABLE (group_id UUID, group_name TEXT, requested_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- `joined_at` (nao `created_at`: a tabela nao tem essa coluna) e preenchido
  -- por DEFAULT now() no INSERT que criou o pedido. Numa linha `pending` ele e
  -- quando a pessoa PEDIU -- ninguem entrou em nada ainda.
  SELECT g.id, g.name, gm.joined_at
  FROM public.group_members gm
  JOIN public.expense_groups g ON g.id = gm.group_id
  WHERE gm.user_id = auth.uid()
    AND gm.status = 'pending'
    AND g.is_active = TRUE
  ORDER BY gm.joined_at DESC;
$$;

-- auth.uid() e NULL para `anon`, entao a funcao ja devolveria zero linha; o
-- REVOKE e para nao depender disso.
REVOKE ALL ON FUNCTION public.my_pending_group_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_pending_group_requests() TO authenticated;
