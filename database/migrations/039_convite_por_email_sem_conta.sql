-- 039_convite_por_email_sem_conta.sql
--
-- HMO-197: "Convite para quem ainda nao tem conta nunca aparece".
--
-- Terceira falha achada na HMO-190. A HMO-196 consertou as outras duas e, para
-- nao deixar lixo no banco, fez a rota RECUSAR o convite quando o email nao tem
-- conta -- resposta 404 mandando o admin passar o codigo do grupo. Era a saida
-- honesta possivel sem migration, e esta migration e o que ela estava esperando.
--
-- Do que a issue descreve, duas pernas JA ESTAO CONSERTADAS (conferido no
-- codigo de origin/main, nao suposto):
--
--   * `lib/hooks/useGroupInvitations.ts` nao filtra mais por
--     `.eq("invited_user_id", user.id)`: ele chama `list_my_group_invitations()`
--     (030). O filtro ainda existe, mas DENTRO da funcao;
--   * `app/api/expense-groups/invite/route.ts` nao grava mais a linha com
--     `invited_user_id` NULO -- ele recusa antes.
--
-- A terceira continua inteira, e e a desta migration: NADA preenche
-- `invited_user_id` no cadastro. Enquanto nao preencher, a unica forma de nao
-- produzir convite invisivel e recusar o convite -- ou seja, "convidar alguem
-- que ainda nao usa o app" simplesmente nao existe como funcionalidade.
--
-- ===========================================================================
-- O QUE PASSA A SER POSSIVEL
-- ===========================================================================
-- O convite para um email SEM conta volta a ser gravado (`invited_user_id`
-- NULO), e o trigger desta migration o entrega no instante em que a conta
-- daquele email nasce. O canal nao muda e continua sendo o escolhido pelo H. na
-- HMO-196 -- "nao usaremos email, sera enviando um convite para o usuario
-- referente daquele email", dentro do app, no sino. A unica diferenca e QUANDO:
-- o convite espera a conta em vez de ser recusado.
--
-- Nada no caminho de leitura muda. `list_my_group_invitations()` (030),
-- `respond_to_group_invitation()` (030) e `has_pending_invitation()` (002)
-- continuam exigindo `invited_user_id = auth.uid()`, e e exatamente por isso que
-- o conserto e preencher esse campo, e nao afrouxar as tres.
--
-- ===========================================================================
-- POR QUE A COMPARACAO E CONTRA auth.users.email, E NAO profiles.email
-- ===========================================================================
-- Esta e a decisao de seguranca do arquivo, e ela nao e cosmetica.
--
-- O trigger dispara AFTER INSERT ON public.profiles, entao `NEW.email` esta na
-- mao e seria o caminho obvio. Ele e forjavel. A policy da 002 e:
--
--     profiles_update_own: USING (id = auth.uid()) WITH CHECK (id = auth.uid())
--
-- Policy de RLS trava a LINHA, nunca a COLUNA -- nao existe OLD dentro de uma
-- policy. Quem esta logado pode escrever qualquer string em `profiles.email` da
-- propria linha, e `garantirPerfil()` (lib/ensure-profile.ts) grava esse campo a
-- partir do cliente. Casar por `profiles.email` seria entao: crio conta com
-- email qualquer, escrevo `profiles.email = 'vitima@...'` e levo os convites
-- endereçados a ela. Em `auth.users` nao ha policy que deixe o usuario escrever,
-- e o endereco so chega la por cadastro/confirmacao no GoTrue.
--
-- O filtro `email_confirmed_at IS NOT NULL` nao e enfeite: ele e LITERALMENTE a
-- condicao que `get_user_by_email()` (001) usa. Isso faz os dois lados serem
-- complementares exatos, e e o que fecha o buraco do meio:
--
--     rota grava invited_user_id NULO  <=>  nao existe conta CONFIRMADA no email
--     trigger reclama o convite        <=>  passou a existir conta CONFIRMADA
--
-- Se as duas condicoes fossem diferentes sobraria um estado sem dono. Com conta
-- NAO confirmada, por exemplo: a rota nao a encontra (grava NULO) e o perfil so
-- nasce em `/auth/callback`, depois do link de email -- quando a confirmacao ja
-- aconteceu e o trigger acha. Com `mailer_autoconfirm` LIGADO o
-- `email_confirmed_at` ja vem preenchido no cadastro, e o trigger acha tambem.
-- Os dois modos de confirmacao do projeto (HMO-157) estao cobertos.
--
-- O que este filtro NAO e: substituto para a confirmacao de email estar ligada.
-- Com autoconfirm ligado, `email_confirmed_at` vem preenchido sem ninguem provar
-- posse do endereco, e ai quem se cadastrar com o email de outra pessoa recebe
-- os convites dela. Isso e uma propriedade do autoconfirm, nao desta migration
-- -- e ja valia para o `get_user_by_email` desde a 001.
--
-- ===========================================================================
-- SECURITY DEFINER, E POR QUE SEM ELE O TRIGGER FALHARIA EM SILENCIO
-- ===========================================================================
-- A policy de UPDATE da 002 e:
--
--     group_invitations_update:
--       USING (invited_user_id = auth.uid() OR is_group_admin(group_id))
--
-- Quem acabou de se cadastrar nao e admin do grupo, e a linha que ele precisa
-- reclamar tem `invited_user_id` NULO -- `NULL = auth.uid()` nao e verdadeiro.
-- Rodando como `authenticated` o UPDATE nao levanta erro nenhum: a RLS so o faz
-- casar com ZERO linha, `GET DIAGNOSTICS` devolve 0, o cadastro termina com
-- sucesso e o convite continua invisivel. Seria a mesma falha de novo, agora
-- escondida atras de um trigger que "existe" -- e por isso o teste afirma a
-- contagem reclamada, e nao so a ausencia de erro.
--
-- Medido, e registrado aqui porque e contraintuitivo: DEFINER na casca do
-- trigger OU na funcao de casamento, qualquer uma das duas SOZINHA, ja resolve
-- -- dentro de uma funcao DEFINER o `current_user` passa a ser o dono dela, e a
-- chamada aninhada herda isso. Trocar so uma das duas por INVOKER e portanto
-- mutante EQUIVALENTE: nao ha assercao que o mate, e nao ha. As duas ficam
-- DEFINER de proposito, e cada uma por um motivo seu:
--
--   * a de dentro, porque e nela que o privilegio e de fato exercido;
--   * a casca, para que a chamada aninhada nunca dependa de `authenticated` ter
--     EXECUTE em `reclamar_convites_orfaos` -- que a SECAO 1 revoga de propria
--     vontade. Ja houve um trigger neste projeto quebrado exatamente assim.
--
-- O que o teste prende e o par: com as duas INVOKER o cadastro deixa de entregar
-- o convite, e a SECAO 9 dele afirma a falha silenciosa diretamente.
--
-- ===========================================================================
-- ESCOPO
-- ===========================================================================
-- Nenhuma tabela, coluna, indice ou policy nasce ou muda aqui. Sao uma funcao
-- (CREATE OR REPLACE), um trigger (DROP IF EXISTS + CREATE) e um UPDATE de
-- backfill que so encosta em linha com `invited_user_id` NULO. O arquivo e
-- idempotente: pode ser colado no SQL Editor mais de uma vez, e a SECAO 3 (o
-- backfill) pode ser recolada sozinha a qualquer momento sem efeito novo.

-- =====================================================
-- SECAO 1: A REGRA DE CASAMENTO, NUM LUGAR SO
-- =====================================================
-- Esta funcao e chamada de DOIS lugares -- o trigger da SECAO 2 (uma conta, no
-- cadastro) e o backfill da SECAO 3 (todas as contas, uma vez). Ela existe para
-- que a regra nao viva duas vezes: um predicado copiado e um predicado que vai
-- divergir, e os dois copias erram em silencio (o UPDATE que casa com zero linha
-- nao e um erro para o Postgres). O teste da HMO-197 chama ESTA funcao, entao o
-- que o CI exercita e o que roda em producao.
--
-- `p_user_id` NULO = todas as contas. E o backfill; nao ha caminho do app que
-- chegue aqui (ver REVOKE abaixo).
CREATE OR REPLACE FUNCTION public.reclamar_convites_orfaos(
  p_user_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reclamados INTEGER;
BEGIN
  -- O JOIN e com auth.users, e nao com profiles, e e a decisao de seguranca do
  -- arquivo (ver cabecalho): profiles.email e escrito pelo proprio usuario.
  --
  -- `u.email_confirmed_at IS NOT NULL` e literalmente a condicao do
  -- get_user_by_email() (001). E ela que faz os dois lados serem complementares:
  -- a rota grava NULO exatamente quando esta funcao nao acharia ninguem.
  --
  -- `gi.invited_user_id IS NULL` e o que torna este UPDATE seguro de reexecutar e
  -- incapaz de roubar convite: convite que ja achou dono nunca troca de dono.
  --
  -- `gi.invite_method = 'email'` porque o invite_target de um convite 'phone' e
  -- um telefone e o de um 'request' e um pedido de entrada (029) -- nenhum dos
  -- dois e um endereco para onde entregar convite.
  --
  -- auth.users.email e UNIQUE, entao o JOIN nao multiplica linha. Dois enderecos
  -- iguais diferindo so na caixa seriam ambiguos sob o LOWER(), mas o GoTrue
  -- normaliza o email na criacao da conta.
  UPDATE public.group_invitations gi
     SET invited_user_id = u.id,
         updated_at      = NOW()
    FROM auth.users u
   WHERE gi.invited_user_id IS NULL
     AND gi.invite_method   = 'email'
     AND gi.status          = 'pending'
     AND gi.expires_at      > NOW()
     AND u.email_confirmed_at IS NOT NULL
     AND LOWER(btrim(u.email)) = LOWER(btrim(gi.invite_target))
     AND (p_user_id IS NULL OR u.id = p_user_id);

  GET DIAGNOSTICS v_reclamados = ROW_COUNT;
  RETURN v_reclamados;
END $$;

COMMENT ON FUNCTION public.reclamar_convites_orfaos(UUID) IS
  'HMO-197: entrega convite de grupo gravado com invited_user_id NULO (email sem '
  'conta na hora do convite) a conta confirmada daquele endereco. p_user_id NULO '
  '= backfill de todas. Casa contra auth.users.email, nunca profiles.email.';

-- Ninguem do app chama isto: a entrega e automatica no cadastro (SECAO 2) e o
-- backfill e um passo de migration. Deixar `authenticated` executar a versao sem
-- argumento seria dar a qualquer usuario um gatilho para reprocessar a tabela
-- inteira. O trigger continua funcionando porque, dentro de uma funcao
-- SECURITY DEFINER, quem chama e o DONO da funcao -- e ele tem EXECUTE.
REVOKE ALL ON FUNCTION public.reclamar_convites_orfaos(UUID)
  FROM PUBLIC, anon, authenticated;

-- =====================================================
-- SECAO 2: O CONVITE ENCONTRA A CONTA QUANDO ELA NASCE
-- =====================================================
CREATE OR REPLACE FUNCTION public.reclamar_convites_do_novo_perfil()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reclamados INTEGER;
BEGIN
  -- SECURITY DEFINER aqui tambem, e nao so na funcao chamada: o trigger dispara
  -- com a sessao de quem acabou de se cadastrar, e e ela que precisa poder
  -- alcancar a funcao. Uma casca INVOKER chamando uma funcao sem EXECUTE para
  -- `authenticated` quebraria o cadastro inteiro.
  v_reclamados := public.reclamar_convites_orfaos(NEW.id);

  IF v_reclamados > 0 THEN
    RAISE NOTICE 'HMO-197: % convite(s) de grupo entregues a conta nova %',
      v_reclamados, NEW.id;
  END IF;

  RETURN NULL;  -- AFTER trigger: o retorno e ignorado.
END $$;

COMMENT ON FUNCTION public.reclamar_convites_do_novo_perfil() IS
  'HMO-197: convite gravado para um email sem conta fica com invited_user_id '
  'NULO e e invisivel para todos. Este trigger o entrega quando a conta daquele '
  'email nasce. Casa contra auth.users.email (profiles.email e escrito pelo '
  'proprio usuario) e so conta confirmada, igual get_user_by_email().';

-- O perfil e o evento certo, e nao o INSERT em auth.users: `garantirPerfil()`
-- (lib/ensure-profile.ts) e o ponto por onde os DOIS jeitos de um cadastro
-- terminar passam -- com confirmacao ligada, por /auth/callback depois do link;
-- com autoconfirm, direto no signUp. E o `upsert` de la usa
-- `ignoreDuplicates`, entao o INSERT acontece UMA vez por conta, no cadastro,
-- e nao a cada login ou troca de senha.
--
-- Nome com prefixo da issue para nao colidir com os dois triggers que a 001 ja
-- pendura em profiles (incluindo create_user_subscription_trigger). A ordem
-- entre eles e irrelevante aqui: nenhum toca group_invitations.
DROP TRIGGER IF EXISTS hmo197_reclamar_convites_trg ON public.profiles;
CREATE TRIGGER hmo197_reclamar_convites_trg
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.reclamar_convites_do_novo_perfil();

-- =====================================================
-- SECAO 3: BACKFILL DOS CONVITES JA ORFAOS
-- =====================================================
-- O trigger da SECAO 2 so vale para conta criada DEPOIS dele. Em producao
-- (projeto odxqjvtxsioksguuevqm) `group_invitations` tinha 5 INSERTs medidos em
-- 2026-09-30, feitos quando a rota ainda gravava `invited_user_id` NULO. Para
-- cada um desses onde a pessoa se cadastrou no meio do caminho, a linha existe,
-- esta pendente, e nenhuma tela do produto consegue mostra-la.
--
-- Pendentes EXPIRADOS ficam de fora de proposito -- ressuscitar um convite de
-- semanas atras nao e conserto, e o admin pode convidar de novo agora que a rota
-- aceita.
--
-- Esta secao pode ser recolada sozinha no SQL Editor a qualquer momento: ela nao
-- encosta em linha que ja tem dono. Vale guardar para o unico caso que o trigger
-- nao cobre -- uma conta confirmada A MAO no painel do Supabase, que nunca passa
-- por /auth/callback e portanto nunca insere perfil.
DO $$
DECLARE
  v_reclamados INTEGER;
BEGIN
  v_reclamados := public.reclamar_convites_orfaos();
  RAISE NOTICE 'HMO-197 backfill: % convite(s) orfao(s) entregues', v_reclamados;
END $$;
