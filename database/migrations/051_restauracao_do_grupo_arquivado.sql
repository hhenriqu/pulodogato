-- 051_restauracao_do_grupo_arquivado.sql
--
-- HMO-203: "Grupo arquivado nao pode ser restaurado por ninguem, e a rota
-- responde 'restaurado com sucesso'".
--
-- Medido em PRODUCAO em 2026-09-30, na mesma linha, antes e depois:
--
--     ANTES:  is_active=false  archived_at=2026-10-01T00:12:31Z  restored_at=null
--     POST /api/expense-groups/<g>/restore  ->  HTTP 200
--                 {"success":true,"message":"Grupo ... restaurado com sucesso!"}
--     DEPOIS: is_active=false  archived_at=2026-10-01T00:12:31Z  restored_at=null
--
-- ===========================================================================
-- O POCO SEM SAIDA
-- ===========================================================================
-- Arquivar o grupo poe o PROPRIO admin em `group_members.status = 'archived'`
-- (o segundo UPDATE do DELETE da rota do grupo). E `is_group_admin()`, do 002,
-- exige `status = 'active'`:
--
--     SELECT EXISTS (SELECT 1 FROM public.group_members
--       WHERE group_id = p_group_id AND user_id = auth.uid()
--         AND role = 'admin' AND status = 'active');
--
-- A policy de UPDATE de `expense_groups` e `USING (is_group_admin(id))`
-- (002, linha 503). Entao, depois de arquivar, medido em prod com a conta que
-- criou o grupo:
--
--     group_members: role=admin  status=archived
--     is_group_admin(<grupo>) -> false
--     PATCH expense_groups?id=eq.<grupo> {is_active:true, archived_at:null}
--       -> HTTP 200, corpo []      <- ZERO linhas, nenhum erro
--
-- Nao e permissao insuficiente de UM usuario: quem nao e admin tambem nao
-- passa, e o admin deixou de ser admin ao arquivar. NAO HA QUEM RESTAURE.
--
-- A RLS filtra as linhas em vez de recusar, o PostgREST devolve 200 com zero
-- linhas, e `supabase-js` sem `.select()` nao entrega contagem -- entao o
-- `if (restoreError)` da rota nunca dispara e ela responde sucesso. O conserto
-- do lado do codigo (`.select()` + linhas afetadas) vem no PR da feature; o que
-- esta migration resolve e o outro lado: nao havia caminho de escrita nenhum
-- para restaurar.
--
-- ===========================================================================
-- POR QUE UMA FUNCAO, E NAO UMA POLICY NOVA
-- ===========================================================================
-- A alternativa era afrouxar a policy de UPDATE de `expense_groups` para
-- aceitar "foi admin deste grupo". Duas razoes contra:
--
--   1. a policy nao limita COLUNA (so LINHA). Um admin arquivado passaria a
--      poder reescrever `name`, `group_code` -- a chave de convite -- e
--      `created_by` do grupo arquivado, por PATCH direto, sem passar por rota
--      nenhuma. A funcao escreve exatamente seis colunas;
--   2. nao daria atomicidade. Restaurar sao DOIS UPDATEs em DUAS tabelas
--      (`expense_groups` e `group_members`), e e justamente o estado parcial
--      que produz o pior sintoma desta issue -- veja a secao seguinte. Duas
--      chamadas PostgREST sao duas transacoes; um corpo plpgsql e uma.
--
-- ===========================================================================
-- O ESTADO PARCIAL, QUE E PIOR QUE O TRAVAMENTO
-- ===========================================================================
-- A rota antiga, depois do primeiro UPDATE nao ter feito nada, seguia adiante e
-- rodava o SEGUNDO (group_members: 'archived' -> 'active'). Esse PASSA -- a
-- policy de UPDATE de `group_members` tem `user_id = auth.uid()` do lado
-- esquerdo do OR, e a trava de coluna do 040 nao olha `status`. O resultado:
--
--     expense_groups.is_active = false     (grupo arquivado)
--     group_members.status     = 'active'  (admin ativo)
--
-- Nesse estado o grupo desaparece das DUAS telas: da lista ativa porque
-- `is_active = false`, e da lista de arquivados porque
-- `GET /api/expense-groups/archived` exige uma linha de membro com
-- `status = 'archived'` -- que nao existe mais. Nem o botao de restaurar fica
-- alcancavel. E `POST /api/expense-groups/invite` ACEITA convidar (o guard dele
-- so olha `group_members`), responde 201, e o convite nunca aparece no sino de
-- ninguem porque `list_my_group_invitations()` (030) filtra `g.is_active = TRUE`.
-- Reproduzido em prod: convite 15a4b3c5-6eee-4007-bd64-9409229a85d7, 201, sino
-- da convidada vazio.
--
-- Por isso a autorizacao aqui aceita `status IN ('active','archived')`: o admin
-- de um grupo que JA caiu no estado parcial tem `status = 'active'` e precisa
-- conseguir restaurar. Exigir 'archived' (como fazia o pre-check da rota)
-- deixaria aquelas linhas de prod travadas para sempre.
--
-- Nada de schema muda aqui: nenhuma tabela, coluna, indice ou policy. E uma
-- funcao nova, com CREATE OR REPLACE, entao o arquivo e idempotente e pode ser
-- colado no SQL Editor mais de uma vez. Nao ha backfill: um grupo no estado
-- parcial pode ter sido arquivado de proposito, e adivinhar entre "restaura" e
-- "re-arquiva" seria decidir pelo dono do grupo. A funcao conserta na chamada.

BEGIN;

-- =====================================================
-- SECAO 1: RESTAURAR, NUMA TRANSACAO
-- =====================================================
-- SECURITY DEFINER porque o chamador legitimo -- o admin do grupo arquivado --
-- e exatamente quem a RLS de `expense_groups` nao deixa escrever. A autorizacao
-- nao pode depender de `is_group_admin()` (e ela que exige o 'active' que o
-- arquivamento tirou), entao e feita aqui dentro, e o criterio e "e admin DESTE
-- grupo, ativo ou arquivado".
--
-- `p_group_id` vem do chamador, mas nao e autorizacao: passar o id de um grupo
-- alheio nao encontra linha de membro para `auth.uid()` e cai em 'nao
-- encontrado ou acesso negado' -- a mesma resposta de grupo inexistente, de
-- proposito, para nao transformar a rota num detector de grupos.
--
-- Os SQLSTATE sao o contrato com a rota, que os traduz em 401/403/404/400:
--
--     28000  nao autenticado                        -> 401
--     P0002  nao encontrado / acesso negado          -> 404
--     42501  nao e admin                             -> 403
--     PDG01  grupo ja esta ativo                     -> 400
--     22000  a escrita nao pegou (conferencia final) -> 500
--
-- `no_data_found` escrito dentro de plpgsql resolve para **P0002**, nao para o
-- 02000 do SQL padrao: as duas condicoes tem o mesmo nome e numeros
-- diferentes. E o P0002 que chega na rota, e e por ele que ela compara.
--
-- `PDG01` e codigo proprio, para "ja esta ativo" nao ter de se disfarcar de
-- "nao encontrado" -- a tela diria que o grupo nao existe.
CREATE OR REPLACE FUNCTION public.restore_archived_group(p_group_id UUID)
RETURNS TABLE (
  group_id         UUID,
  group_name       TEXT,
  is_active        BOOLEAN,
  restored_at      TIMESTAMPTZ,
  members_restored INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- use_column: as colunas de saida (group_id, is_active, restored_at) repetem
-- nomes de colunas de expense_groups e group_members, e sem a diretiva os
-- UPDATEs abaixo nao compilam. Mesma armadilha da respond_to_group_invitation.
#variable_conflict use_column
DECLARE
  v_role     TEXT;
  v_was      public.expense_groups%ROWTYPE;
  v_now      public.expense_groups%ROWTYPE;
  v_members  INTEGER;
  v_sobrou   INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao autenticado' USING ERRCODE = '28000';
  END IF;

  -- A AUTORIZACAO. `status IN ('active','archived')` e o ponto da issue: o
  -- arquivamento rebaixa o admin para 'archived', e o estado parcial o deixa em
  -- 'active' -- os dois tem de passar. O que NAO passa: 'removed', 'inactive' e
  -- 'pending' (quem foi tirado do grupo, ou nunca foi aprovado, nao desarquiva
  -- nada).
  SELECT gm.role INTO v_role
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id
    AND gm.user_id = auth.uid()
    AND gm.status IN ('active', 'archived');

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'grupo nao encontrado ou acesso negado'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'apenas administradores podem restaurar grupos'
      USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE serializa dois cliques simultaneos no botao Restaurar: sem o
  -- lock as duas requisicoes leem `is_active = false` e as duas seguem.
  SELECT * INTO v_was
  FROM public.expense_groups g
  WHERE g.id = p_group_id
  FOR UPDATE;

  IF v_was.id IS NULL THEN
    RAISE EXCEPTION 'grupo nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_was.is_active THEN
    RAISE EXCEPTION 'este grupo ja esta ativo' USING ERRCODE = 'PDG01';
  END IF;

  -- Os dois UPDATEs. Mesma transacao, e nessa ordem apenas por legibilidade:
  -- num corpo plpgsql o estado intermediario nao e observavel por ninguem, e um
  -- RAISE depois daqui desfaz os dois. E isso que torna impossivel o estado
  -- parcial descrito no cabecalho.
  UPDATE public.expense_groups
     SET is_active   = TRUE,
         archived_at = NULL,
         archived_by = NULL,
         restored_at = NOW(),
         restored_by = auth.uid(),
         updated_at  = NOW()
   WHERE id = p_group_id;

  UPDATE public.group_members
     SET status      = 'active',
         archived_at = NULL,
         restored_at = NOW(),
         updated_at  = NOW()
   WHERE group_id = p_group_id
     AND status = 'archived';

  GET DIAGNOSTICS v_members = ROW_COUNT;

  -- ZERO membro restaurado NAO e falha, e isto nao e descuido: no estado
  -- parcial (grupo arquivado, admin ja 'active') nao sobrou ninguem em
  -- 'archived' para mexer, e a restauracao do grupo e exatamente o que se quer
  -- ali. Quem responde pela consistencia e a conferencia abaixo, nao esta
  -- contagem -- ela e informacao para a rota, nao criterio.

  -- A CONFERENCIA, LENDO DE VOLTA DO BANCO.
  -- A resposta da rota antiga exibia um `restored_at` montado com
  -- `new Date().toISOString()` em JavaScript: ela DESCREVIA a escrita em vez de
  -- medir. O que esta funcao devolve sai deste SELECT, depois dos UPDATEs. Se
  -- algum dia um trigger, uma policy ou uma coluna nova fizer a escrita nao
  -- pegar, o caminho morre aqui com erro -- nao sai dizendo que restaurou.
  SELECT * INTO v_now
  FROM public.expense_groups g
  WHERE g.id = p_group_id;

  IF v_now.is_active IS NOT TRUE OR v_now.restored_at IS NULL THEN
    RAISE EXCEPTION 'a restauracao do grupo % nao ficou gravada (is_active=%, restored_at=%)',
      p_group_id, v_now.is_active, v_now.restored_at
      USING ERRCODE = 'data_exception';
  END IF;

  -- O invariante da issue, do outro lado: grupo ativo nao pode ficar com membro
  -- arquivado. Se sobrou alguem, a transacao inteira volta -- melhor o grupo
  -- continuar arquivado, e dizendo que continua, do que ativo e sem metade dos
  -- participantes.
  SELECT count(*) INTO v_sobrou
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id
    AND gm.status = 'archived';

  IF v_sobrou > 0 THEN
    RAISE EXCEPTION 'grupo % ficaria ativo com % membro(s) ainda arquivado(s)',
      p_group_id, v_sobrou
      USING ERRCODE = 'data_exception';
  END IF;

  RETURN QUERY SELECT v_now.id, v_now.name, v_now.is_active, v_now.restored_at, v_members;
END $$;

-- auth.uid() e NULL para `anon`, entao a funcao ja levantaria 28000; o REVOKE e
-- para nao depender disso. Sem o GRANT a rota responde 42501 para TODO MUNDO --
-- o mesmo SQLSTATE que esta funcao usa para "nao e admin", o que faria a tela
-- dizer "apenas administradores" a um admin. Por isso o bloco de prova confere.
REVOKE ALL ON FUNCTION public.restore_archived_group(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_archived_group(UUID) TO authenticated;

COMMENT ON FUNCTION public.restore_archived_group(UUID) IS
  'HMO-203: desarquiva o grupo e os membros numa transacao. Autoriza por "e admin deste grupo, ativo ou arquivado" -- is_group_admin() exige active, e arquivar rebaixa o proprio admin. Devolve o estado LIDO DE VOLTA do banco.';

-- ---------------------------------------------------------------------------
-- Prova
-- ---------------------------------------------------------------------------
-- O arquivo aborta se algo nao pegou. Sem isto, colar a migration num banco
-- onde uma metade falhou em silencio sai verde, e o poco continua de pe com um
-- "aplicado" no historico.
DO $$
DECLARE
  problemas text := '';
  v_oid     oid;
BEGIN
  v_oid := to_regprocedure('public.restore_archived_group(uuid)');

  IF v_oid IS NULL THEN
    RAISE EXCEPTION '051 nao criou public.restore_archived_group(uuid)';
  END IF;

  -- SECURITY DEFINER e o unico motivo de a funcao existir: INVOKER a faria cair
  -- na mesma policy `USING (is_group_admin(id))` que trava o admin arquivado, e
  -- ela voltaria a atualizar zero linha -- agora em silencio dentro do corpo.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND prosecdef) THEN
    problemas := problemas || E'\n  - restore_archived_group ficou SECURITY INVOKER; tem que ser DEFINER, senao a RLS filtra o UPDATE de novo';
  END IF;

  IF (SELECT proconfig FROM pg_proc WHERE oid = v_oid) IS NULL THEN
    problemas := problemas || E'\n  - restore_archived_group ficou sem search_path fixo';
  END IF;

  -- O GRANT nao e opcional: sem ele a rota recebe 42501 para qualquer chamador.
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    problemas := problemas || E'\n  - authenticated nao tem EXECUTE em restore_archived_group(uuid); nenhum usuario do app restauraria';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    problemas := problemas || E'\n  - anon ficou com EXECUTE em restore_archived_group(uuid)';
  END IF;

  -- As seis colunas que o corpo escreve. Vieram da 020; se alguma faltar, o
  -- corpo nao compilaria -- mas `CREATE OR REPLACE FUNCTION` em plpgsql NAO
  -- valida o SQL do corpo na criacao, so no primeiro disparo. Sem este bloco a
  -- migration passaria verde e a falha apareceria no clique do usuario.
  IF to_regclass('public.expense_groups') IS NULL THEN
    problemas := problemas || E'\n  - public.expense_groups nao existe';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'expense_groups'
                     AND column_name = 'restored_at') THEN
      problemas := problemas || E'\n  - expense_groups.restored_at nao existe (020); o corpo a escreve';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'expense_groups'
                     AND column_name = 'restored_by') THEN
      problemas := problemas || E'\n  - expense_groups.restored_by nao existe (020); o corpo a escreve';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'group_members'
                   AND column_name = 'restored_at') THEN
    problemas := problemas || E'\n  - group_members.restored_at nao existe (020); o corpo a escreve';
  END IF;

  -- 'archived' em group_members.status: e o valor que a autorizacao desta
  -- funcao aceita e que o segundo UPDATE procura. O 020 o acrescentou ao
  -- group_members_status_check; sem ele nao ha membro arquivado para restaurar.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'group_members_status_check'
      AND conrelid = to_regclass('public.group_members')
      AND pg_get_constraintdef(oid) LIKE '%archived%'
  ) THEN
    problemas := problemas || E'\n  - group_members_status_check nao aceita ''archived'' (020); a funcao nao teria o que restaurar';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION '051 nao ficou completa:%', problemas;
  END IF;

  RAISE NOTICE '051 ok: restore_archived_group(uuid) DEFINER, com EXECUTE para authenticated e nao para anon';
END $$;

COMMIT;
