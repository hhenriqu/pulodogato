-- 040_trava_de_percentual_e_papel_do_membro.sql
--
-- HMO-268 (fase 2 de 7 da HMO-245): `group_members_update` nao congela
-- `percentage` nem `role`, e qualquer membro escreve os dois na PROPRIA linha.
--
-- ===========================================================================
-- O QUE ESTA ABERTO
-- ===========================================================================
-- A policy de UPDATE de `group_members` (002_rls_lockdown.sql:526) e a mesma
-- dos dois lados:
--
--     USING      (user_id = auth.uid() OR public.is_group_admin(group_id))
--     WITH CHECK (user_id = auth.uid() OR public.is_group_admin(group_id))
--
-- Ela diz QUAIS LINHAS alguem alcanca, nunca QUAIS COLUNAS -- policy de RLS nao
-- compara OLD com NEW, entao "esta coluna nao muda" e uma frase que policy
-- nenhuma consegue dizer. E o ramo `user_id = auth.uid()` entrega ao membro
-- comum a propria linha INTEIRA.
--
-- Medido como `authenticated` de verdade no banco da cadeia 001..039, com o
-- membro comum B do grupo do admin A -- as tres voltaram `UPDATE 1`:
--
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claim.sub = '<o B>';
--     UPDATE group_members SET percentage = 0.01   WHERE id = '<a linha do B>';
--     UPDATE group_members SET role       = 'admin' WHERE id = '<a linha do B>';
--     UPDATE group_members SET group_id   = '<outro grupo>' WHERE id = '<a do B>';
--
-- Nao e estado que so se forja por dentro do banco: o 002 deu
-- `GRANT ... UPDATE ON ALL TABLES ... TO authenticated` (linha 382) e o
-- PostgREST expoe a tabela, entao o caminho e um PATCH com a chave anon --
-- que sai do bundle -- numa sessao comum.
--
-- ===========================================================================
-- POR QUE AGORA, SE A COLUNA NAO FAZ NADA
-- ===========================================================================
-- Hoje `percentage` e quase inofensiva: ate a fase 3 nenhuma conta sai dela.
-- A fase 4 (HMO-270) faz dela o PESO do rateio do fechamento do mes -- e no dia
-- em que isso entra, este UPDATE deixa de ser enfeite e passa a ser "eu pago
-- 0,01% do aluguel", escrito pelo proprio devedor, sem passar por tela nenhuma.
--
-- `role` nao espera a fase 4: a guarda de "so admin promove" mora na ROTA
-- (`app/api/expense-groups/[groupId]/members/[memberId]/role/route.ts:39`), e
-- nao no banco. O membro que escreve `role = 'admin'` na propria linha vira
-- admin do grupo HOJE, e com isso ganha a policy de admin em
-- `expense_groups`, `group_transactions` e nas linhas dos colegas.
--
-- ===========================================================================
-- POR QUE TRIGGER, E NAO POLICY
-- ===========================================================================
-- Nao da para fechar com policy, e o motivo e estrutural: a unica coisa que
-- distingue a escrita legitima da ilegitima aqui e a COMPARACAO entre a linha
-- velha e a nova, e `WITH CHECK` so enxerga a nova. Quebrar
-- `group_members_update` em duas policies tambem nao ajuda -- policies
-- permissivas sao OR entre si, entao o par teria o mesmo predicado efetivo que
-- a policy unica de hoje. A policy do 002 fica como esta.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION CONGELA ALEM DO QUE A ISSUE PEDIU, E POR QUE
-- ===========================================================================
-- A HMO-268 pede `percentage` e `role`. `group_id` e `user_id` entram junto, e
-- a razao e a terceira linha do bloco medido acima: mover a PROPRIA linha para
-- outro `group_id` passa pela policy (o `user_id` continua sendo o de quem
-- escreve nos dois lados do OR), e quem faz isso entra num grupo que nunca o
-- convidou -- com o `role` que a linha ja carregava. Encadeado com o UPDATE de
-- `role`, o membro comum de um grupo qualquer vira ADMIN de qualquer grupo cujo
-- UUID ele conheca, e passa a ler todas as despesas de lá.
--
-- E o mesmo defeito (policy que nao compara OLD com NEW), na mesma tabela, pelo
-- mesmo caminho, e custa duas comparacoes no trigger que ja esta sendo escrito.
-- Travar `percentage` e deixar essa porta aberta seria entregar meia migration:
-- nao adianta o devedor nao poder baixar a propria parte no grupo do aluguel se
-- ele pode se mudar para o grupo do lado.
--
-- Os dois sao congelados para TODO MUNDO, admin inclusive -- nao e "so admin
-- faz", e "isto nao e edicao". Trocar o grupo ou a pessoa de uma linha de
-- `group_members` nao e corrigir um cadastro: e transformar a participacao de
-- alguem na participacao de outro, mantendo o `id` que `group_expense_splits` e
-- `group_member_proportions` referenciam por FK. Quem precisa de outro membro
-- insere outro membro.
--
-- Levantado contra todos os escritores que existem hoje, e nenhum deles muda
-- nenhuma das quatro colunas:
--
--   * `split-config/route.ts:263` e o UNICO escritor de `percentage` no app, e
--     ja exige `role === 'admin'` (linha 160) -- o trigger passa a dizer no
--     banco a mesma regra que a rota ja diz em HTTP. O upsert dele manda
--     `group_id` e `user_id` no payload (precisa: ver o cabecalho da rota), mas
--     com os valores LIDOS do banco, entao `IS DISTINCT FROM` da falso e o
--     congelamento nao o alcanca;
--   * `members/[memberId]/role/route.ts:100` escreve `role`, e tambem ja exige
--     admin;
--   * `join_group_by_code()` (002:361, 029:135) e `respond_to_group_invitation()`
--     (030:231) chegam aqui por `ON CONFLICT ... DO UPDATE`, que DISPARA BEFORE
--     UPDATE. As tres tocam `status` e `updated_at` e mais nada -- se alguma
--     tocasse `role`, entrar em grupo passaria a ser recusado para quem nao e
--     admin dele, que e justamente quem esta entrando. Vale reconferir isso ao
--     mexer nessas funcoes;
--   * `leave/route.ts` (status, left_at), `[groupId]/route.ts:399` (archived),
--     `restore/route.ts:92` (active) e `approve/route.ts:86` (status) nao tocam
--     nenhuma das quatro. O `leave` recusa a saida do unico admin em vez de
--     promover alguem (linha 74), entao nao existe promocao automatica que o
--     trigger precise deixar passar.
--
-- ===========================================================================
-- IDEMPOTENTE
-- ===========================================================================
-- Producao nao tem runner de migration: alguem cola este arquivo no SQL Editor
-- do Supabase (ver a nota no topo do 015). `CREATE OR REPLACE FUNCTION` mais
-- `DROP TRIGGER IF EXISTS` antes do `CREATE TRIGGER` fazem a segunda passada
-- ser inofensiva, e nenhuma linha aqui e meta-comando do psql (`\...`) -- uma
-- unica delas reprovaria o arquivo INTEIRO no SQL Editor.

BEGIN;

-- ---------------------------------------------------------------------------
-- A guarda
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER explicito e `search_path` fixo, como a `expense_splits_guard`
-- do 025. INVOKER e o certo: a unica pergunta privilegiada do corpo ("quem
-- escreve e admin deste grupo?") e feita por `public.is_group_admin`, que o 002
-- ja criou SECURITY DEFINER exatamente para poder ler `group_members` sem RLS.
-- Reusar a funcao do 002 em vez de repetir o EXISTS aqui nao e economia de
-- linha: e o que garante que a definicao de "admin do grupo" usada pelo trigger
-- nao possa divergir da que as policies usam. Duas copias dessa regra, uma
-- delas desatualizada, e um buraco com cara de redundancia.
--
-- `auth.uid() IS NULL` passa direto. Quem chega assim e `service_role`, cron ou
-- psql direto -- backend nosso, que precisa poder corrigir cadastro de membro e
-- rodar backfill. Nao e brecha para o app: `anon` levou `REVOKE ALL` da tabela
-- no 002 (SECAO 2), e um `authenticated` sem claim `sub` teria `user_id = NULL`
-- e `is_group_admin(...) = FALSE` na policy de UPDATE -- os dois lados do OR
-- dao NULL ou FALSE, nenhum e TRUE, e a RLS nao lhe entrega linha nenhuma para
-- este trigger julgar.
--
-- `IS DISTINCT FROM`, e nao `<>`, nas quatro: `percentage` e NULLABLE (001:1215
-- -- `numeric(5,2) DEFAULT 0.00`, sem NOT NULL). Com `<>`, sair de NULL para
-- 0.01 daria NULL, que nao e TRUE, e o IF nao entraria -- a trava passaria ao
-- largo de toda linha cujo percentual nunca foi preenchido, que sao todas as
-- que nenhum admin configurou ainda. O operador correto aqui e o unico que
-- trata NULL como valor.
CREATE OR REPLACE FUNCTION public.group_members_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Identidade da linha, congelada para todo mundo -- ver o cabecalho.
  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    RAISE EXCEPTION
      'linha de group_members nao troca de grupo: entre no outro grupo em vez de mudar esta (era %, veio %)',
      OLD.group_id, NEW.group_id
      USING ERRCODE = '42501';
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION
      'linha de group_members nao troca de pessoa: adicione o outro membro em vez de mudar esta (era %, veio %)',
      OLD.user_id, NEW.user_id
      USING ERRCODE = '42501';
  END IF;

  -- O peso do rateio a partir da fase 4. Sobe E desce: "so para cima" seria
  -- trava pela metade, e pagar menos do que se deve e o lado que custa dinheiro
  -- aos outros membros.
  IF NEW.percentage IS DISTINCT FROM OLD.percentage
     AND NOT public.is_group_admin(OLD.group_id) THEN
    RAISE EXCEPTION
      'so um admin do grupo muda o percentual de divisao do membro (era %, veio %)',
      OLD.percentage, NEW.percentage
      USING ERRCODE = '42501';
  END IF;

  -- `is_group_admin(OLD.group_id)` e nao `NEW`: o grupo da linha ja esta
  -- congelado acima, entao os dois sao iguais quando a execucao chega aqui --
  -- OLD e o que deixa isso explicito para quem ler depois, e e o que continua
  -- certo se um dia o congelamento do grupo sair.
  IF NEW.role IS DISTINCT FROM OLD.role
     AND NOT public.is_group_admin(OLD.group_id) THEN
    RAISE EXCEPTION
      'so um admin do grupo muda o papel do membro (era %, veio %)',
      OLD.role, NEW.role
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_group_members_guard ON public.group_members;
CREATE TRIGGER trg_group_members_guard
  BEFORE UPDATE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.group_members_guard();

-- Sem REVOKE, pelos dois motivos escritos no 025: no Supabase
-- `REVOKE ... FROM PUBLIC` nao fecha concessao nominal a
-- `anon`/`authenticated`/`service_role`, e aqui nao ha o que fechar -- a funcao
-- devolve `trigger`, o Postgres recusa chamada direta ("can only be called as a
-- trigger") e o PostgREST nao expoe esse tipo de retorno como RPC.
--
-- O que este trigger PRECISA e o contrario de um revoke: que `authenticated`
-- NAO perca o `EXECUTE` em `public.is_group_admin(UUID)`, concedido no 002
-- (linha 304). O corpo acima a chama com `NOT public.is_group_admin(...)`, e
-- chamada de funcao DENTRO do corpo e checada no disparo -- ao contrario do
-- EXECUTE da propria funcao de trigger, que e checado na criacao do trigger.
-- Revogar aquele GRANT achando que e endurecimento nao abriria a trava: ela
-- falharia FECHADA, com `permission denied for function is_group_admin` --
-- 42501, o mesmo SQLSTATE das recusas legitimas -- e o que quebraria e o
-- caminho do ADMIN. E por isso que a SECAO 6 do teste existe, e por isso que o
-- bloco de prova abaixo confere o GRANT.

-- ---------------------------------------------------------------------------
-- Prova
-- ---------------------------------------------------------------------------
-- O arquivo aborta se algo nao pegou. Sem isto, colar a migration num banco
-- onde uma metade falhou em silencio sai verde, e o buraco continua de pe com
-- um "aplicado" no historico.
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF to_regprocedure('public.group_members_guard()') IS NULL THEN
    RAISE EXCEPTION '040 nao criou public.group_members_guard()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = to_regclass('public.group_members')
      AND tgname = 'trg_group_members_guard'
      AND NOT tgisinternal
  ) THEN
    problemas := problemas || E'\n  - o trigger trg_group_members_guard nao ficou em group_members';
  END IF;

  -- BEFORE e FOR EACH ROW nao sao detalhe: um AFTER nao pode recusar via
  -- RAISE sem desfazer escrita ja feita, e um trigger de STATEMENT nao tem
  -- OLD/NEW -- que e a unica coisa que esta migration tem para olhar.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = to_regclass('public.group_members')
      AND tgname = 'trg_group_members_guard'
      AND (tgtype & 1) = 1    -- FOR EACH ROW
      AND (tgtype & 2) = 2    -- BEFORE
      AND (tgtype & 16) = 16  -- UPDATE
  ) THEN
    problemas := problemas || E'\n  - trg_group_members_guard nao e BEFORE UPDATE FOR EACH ROW';
  END IF;

  -- INVOKER e parte do desenho: DEFINER faria o corpo rodar como o dono da
  -- funcao, e `auth.uid()` continuaria sendo o do chamador -- nao mudaria a
  -- decisao, mas criaria um caminho sem RLS nesta tabela que ninguem precisa.
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = to_regprocedure('public.group_members_guard()') AND prosecdef
  ) THEN
    problemas := problemas || E'\n  - group_members_guard ficou SECURITY DEFINER; tem que ser INVOKER';
  END IF;

  IF (SELECT proconfig FROM pg_proc
      WHERE oid = to_regprocedure('public.group_members_guard()')) IS NULL THEN
    problemas := problemas || E'\n  - group_members_guard ficou sem search_path fixo';
  END IF;

  -- A dependencia do corpo. Sem este GRANT o trigger falha fechado no caminho
  -- do admin, com um 42501 que se le como recusa legitima -- ver a nota acima.
  IF to_regprocedure('public.is_group_admin(uuid)') IS NULL THEN
    problemas := problemas || E'\n  - public.is_group_admin(uuid) nao existe; o corpo do trigger a chama';
  ELSIF NOT has_function_privilege(
          'authenticated', to_regprocedure('public.is_group_admin(uuid)'), 'EXECUTE') THEN
    problemas := problemas || E'\n  - authenticated perdeu EXECUTE em is_group_admin(uuid); o admin nao consegue mais mudar percentual nem papel';
  END IF;

  -- O trigger so vale se a tabela ainda tiver RLS: sem ela a policy de UPDATE
  -- nem limita as LINHAS, e travar coluna vira consolo.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = to_regclass('public.group_members') AND relrowsecurity
  ) THEN
    problemas := problemas || E'\n  - group_members esta sem RLS; a trava de coluna nao substitui a de linha';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION '040 nao ficou completa:%', problemas;
  END IF;

  RAISE NOTICE '040 ok: trg_group_members_guard em group_members, INVOKER, com is_group_admin alcancavel por authenticated';
END $$;

COMMIT;
