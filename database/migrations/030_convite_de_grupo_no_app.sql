-- 030_convite_de_grupo_no_app.sql
--
-- HMO-196: "Convite de grupo nao e entregue".
--
-- A HMO-190 deixou escrito que o envio de convite "NUNCA existiu" e que faltava
-- escolher um canal (provedor de email x botao de compartilhar). O H. escolheu
-- um terceiro: "Nao usaremos email, sera enviando um convite para o usuario
-- referente daquele email" -- convite DENTRO do app, para a conta dona daquele
-- endereco.
--
-- E aqui vem a parte que a descricao da issue erra, e vale registrar porque ela
-- muda o tamanho do conserto: esse canal JA ESTAVA TODO CONSTRUIDO. Existe o
-- sino (`components/ui/notifications.tsx`), ele ja tem os botoes Aceitar e
-- Rejeitar, existe o hook que busca os convites (`lib/hooks/useNotifications.ts`)
-- e existe a rota que aceita (`/api/expense-groups/join` com `invitation_id`).
-- A RLS da 002 ja foi escrita pensando nesse fluxo: `group_invitations_select`
-- tem `invited_user_id = auth.uid()`, e `group_members_insert` tem
-- `has_pending_invitation(group_id)`.
--
-- Medido em producao (projeto odxqjvtxsioksguuevqm, 2026-09-30):
--
--     pg_stat_all_tables.n_tup_ins  group_invitations = 5
--     get_user_by_email('leticia.macoliver@gmail.com')
--       -> 6582dc50-455b-46d4-ae62-eedf85cbd83e   (conta existe e esta confirmada)
--
-- Ou seja: os convites foram gravados, e a pessoa convidada existe. Nao faltava
-- envio. O convite estava lá, endereçado a ela, e o app nao mostrava.
--
-- ===========================================================================
-- POR QUE O SINO FICAVA VAZIO
-- ===========================================================================
-- O hook lia o convite com dois embeds do PostgREST:
--
--     group:expense_groups(name, description, group_code)
--     inviter:profiles!group_invitations_invited_by_fkey(full_name, avatar_url)
--
-- Os dois caem na RLS de quem esta lendo -- a convidada:
--
--     expense_groups_select         := created_by = auth.uid() OR is_group_member(id)
--     profiles_select_own_or_public := id = auth.uid() OR is_public = true
--
-- Ela nao criou o grupo e nao e membro (o convite nao cria linha em
-- `group_members`): o grupo e invisivel. E quem convidou nao e ela e nao tem
-- perfil publico: o inviter e invisivel. PostgREST nao levanta erro nesse caso,
-- devolve `null` em cada embed -- e o hook entao descarta a linha:
--
--     if (!invite.group || !invite.inviter) { console.warn(...); return false; }
--
-- O convite existia, era legivel, e era jogado fora na ultima linha do caminho,
-- num console.warn. Reproduzido contra a cadeia inteira num Postgres 17 limpo:
-- o SELECT em `group_invitations` devolve 1, e os dois embeds devolvem 0.
--
-- As duas policies estao CERTAS e nao sao afrouxadas aqui. Quem foi convidado e
-- ainda nao aceitou nao pode ler o grupo (despesas, membros) nem varrer perfil
-- alheio. O que falta e o mesmo que faltava no pedido por codigo: uma funcao que
-- devolva o pouco que a tela precisa -- e so isso -- checando a autorizacao
-- dentro dela. Mesmo desenho da `my_pending_group_requests()`.
--
-- ===========================================================================
-- E O ACEITE TAMBEM ESTAVA QUEBRADO, PELO MESMO MOTIVO
-- ===========================================================================
-- Nao e so a lista. `/api/expense-groups/join` lia o convite com
-- `group:expense_groups(id, name, ...)` e depois respondia
-- `invitation.group.name`. Com o embed nulo isso e um TypeError, que o catch
-- transforma em 500 "Internal server error". Entao mesmo que a convidada tivesse
-- visto o convite, aceitar devolveria erro de servidor. Por isso o aceite passa a
-- ser uma funcao: uma transacao, sem depender de embed que a RLS esconde.
--
-- Nada de schema muda aqui: nenhuma tabela, coluna, indice ou policy. Sao duas
-- funcoes novas, as duas CREATE OR REPLACE, entao o arquivo e idempotente e pode
-- ser colado no SQL Editor mais de uma vez.

-- =====================================================
-- SECAO 1: A PESSOA CONVIDADA VE O PROPRIO CONVITE
-- =====================================================
-- SECURITY DEFINER porque o nome do grupo e o nome de quem convidou estao em
-- duas tabelas que a RLS esconde de quem ainda nao aceitou -- e e exatamente
-- essa a informacao sem a qual o convite nao pode ser apresentado ("Fulano te
-- convidou para o grupo Tal").
--
-- Sem argumento, pelo mesmo motivo da `my_pending_group_requests()`: nao ha nada
-- que o chamador possa passar para apontar a funcao para o convite de outra
-- pessoa. O filtro e `gi.invited_user_id = auth.uid()`, dentro do corpo.
--
-- O que ela expoe, no maximo: o nome/descricao de um grupo para o qual um admin
-- daquele grupo deliberadamente convidou esta pessoa, e o nome de quem convidou.
--
-- `group_code` NAO entra de proposito, embora o sino antigo o exibisse. Quem
-- aceita vira membro e passa a ver o codigo pela tela do grupo; quem recusa nao
-- tem por que sair com um codigo de entrada na mao. Os botoes Aceitar/Recusar
-- nao precisam dele.
CREATE OR REPLACE FUNCTION public.list_my_group_invitations()
RETURNS TABLE (
  invitation_id      UUID,
  group_id           UUID,
  group_name         TEXT,
  group_description  TEXT,
  inviter_name       TEXT,
  inviter_avatar_url TEXT,
  invite_message     TEXT,
  expires_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gi.id,
         g.id,
         g.name,
         g.description,
         p.full_name,
         p.avatar_url,
         gi.message,
         gi.expires_at,
         gi.created_at
  FROM public.group_invitations gi
  JOIN public.expense_groups g ON g.id = gi.group_id
  -- LEFT JOIN por defesa, nao por necessidade: `group_invitations.invited_by` e
  -- NOT NULL com FK para `profiles(id)`, entao hoje a linha sempre existe (e se
  -- o perfil for apagado, o ON DELETE CASCADE leva o convite junto). O que E
  -- alcancavel, e o caso da propria HMO-196, e `full_name` NULO: a Leticia em
  -- producao tem conta confirmada e `full_name = null`. Por isso nao ha filtro
  -- `p.full_name IS NOT NULL` aqui -- um convite nao pode desaparecer porque
  -- quem convidou nunca preencheu o nome. Quem trata o nulo e a tela.
  LEFT JOIN public.profiles p ON p.id = gi.invited_by
  WHERE gi.invited_user_id = auth.uid()
    AND gi.status = 'pending'
    AND gi.expires_at > NOW()
    AND g.is_active = TRUE
  ORDER BY gi.created_at DESC;
$$;

-- auth.uid() e NULL para `anon`, entao a funcao ja devolveria zero linha; o
-- REVOKE e para nao depender disso.
REVOKE ALL ON FUNCTION public.list_my_group_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_group_invitations() TO authenticated;

-- =====================================================
-- SECAO 2: ACEITAR OU RECUSAR, NUMA TRANSACAO
-- =====================================================
-- A RLS da 002 permitiria os tres passos soltos (ler o convite proprio, se
-- inserir em `group_members` via `has_pending_invitation`, marcar o convite como
-- respondido). Eles viram uma funcao por tres motivos:
--
--   1. atomicidade. Solto, o passo 2 pode gravar o membro e o passo 3 falhar: a
--      pessoa entra no grupo e o convite fica `pending` para sempre, entao o sino
--      continua oferecendo Aceitar um convite ja aceito;
--   2. o nome do grupo na resposta ("Voce entrou no grupo X") vem de
--      `expense_groups`, que a RLS ainda esconde no instante em que a funcao
--      comeca -- era isso que estourava TypeError -> 500 na rota;
--   3. `FOR UPDATE` no convite. Dois cliques em Aceitar sao duas requisicoes
--      concorrentes; sem o lock as duas passam pelo mesmo `status = 'pending'`.
--
-- A autorizacao e checada aqui dentro e NAO e "o chamador mandou um id": o
-- convite tem que estar endereçado a `auth.uid()`. Passar o id do convite de
-- outra pessoa nao encontra linha nenhuma.
CREATE OR REPLACE FUNCTION public.respond_to_group_invitation(
  p_invitation_id UUID,
  p_accept        BOOLEAN
)
RETURNS TABLE (group_id UUID, group_name TEXT, member_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- use_column: as colunas de saida (group_id, ...) repetem nomes de colunas de
-- group_members, e sem a diretiva o ON CONFLICT abaixo nao compila. Mesma
-- armadilha da join_group_by_code.
#variable_conflict use_column
DECLARE
  v_invitation public.group_invitations%ROWTYPE;
  v_group      public.expense_groups%ROWTYPE;
  v_current    TEXT;
  v_status     TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao autenticado' USING ERRCODE = '28000';
  END IF;

  -- O filtro por invited_user_id E a autorizacao. FOR UPDATE serializa dois
  -- cliques simultaneos no mesmo convite.
  SELECT * INTO v_invitation
  FROM public.group_invitations gi
  WHERE gi.id = p_invitation_id
    AND gi.invited_user_id = auth.uid()
    AND gi.status = 'pending'
    AND gi.expires_at > NOW()
  FOR UPDATE;

  IF v_invitation.id IS NULL THEN
    RAISE EXCEPTION 'convite nao encontrado, expirado ou ja respondido'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO v_group
  FROM public.expense_groups g
  WHERE g.id = v_invitation.group_id AND g.is_active = TRUE;

  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'grupo nao esta mais ativo' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT p_accept THEN
    UPDATE public.group_invitations
       SET status = 'rejected', responded_at = NOW(), updated_at = NOW()
     WHERE id = v_invitation.id;

    RETURN QUERY SELECT v_group.id, v_group.name, 'rejected'::TEXT;
    RETURN;
  END IF;

  -- alias obrigatorio: `group_id` sem qualificar colide com a coluna de saida.
  SELECT gm.status INTO v_current
  FROM public.group_members gm
  WHERE gm.group_id = v_group.id
    AND gm.user_id = auth.uid();

  IF v_current = 'active' THEN
    -- Ja e membro (entrou pelo codigo e foi aprovada antes de abrir o sino, por
    -- exemplo). Nao e erro: e o estado que o convite pedia. Fecha o convite para
    -- o sino parar de oferecer, e responde o estado de verdade.
    v_status := 'active';
  ELSE
    -- Convite de admin entra como 'active' -- diferente da entrada por codigo em
    -- grupo privado, que nasce 'pending' porque ninguem chamou aquela pessoa.
    -- Aqui um admin do grupo enderecou o convite a ela, e aceitar E a aprovacao.
    v_status := 'active';

    INSERT INTO public.group_members AS gm (group_id, user_id, role, status)
    VALUES (v_group.id, auth.uid(), 'member', v_status)
    ON CONFLICT (group_id, user_id)
    DO UPDATE SET status = v_status, updated_at = NOW();
  END IF;

  UPDATE public.group_invitations
     SET status = 'accepted', responded_at = NOW(), updated_at = NOW()
   WHERE id = v_invitation.id;

  RETURN QUERY SELECT v_group.id, v_group.name, v_status;
END $$;

REVOKE ALL ON FUNCTION public.respond_to_group_invitation(UUID, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_group_invitation(UUID, BOOLEAN)
  TO authenticated;
