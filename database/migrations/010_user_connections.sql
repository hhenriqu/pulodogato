-- =====================================================
-- PULODOGATO - CONEXOES ENTRE USUARIOS
-- =====================================================
-- Migration: 010_user_connections
-- Gerado em: 2026-09-22  (HMO-124)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.user_connections   o pedido de conexao entre duas pessoas e o que
--                             aconteceu com ele (pendente / aceito / bloqueado)
--
-- Como o 008 e o 009, este arquivo so ACRESCENTA: nenhuma funcao, tabela,
-- policy ou trigger de producao e alterada.
--
-- POR QUE ESTA TABELA EXISTE
-- ---------------------------
-- Ela nao e uma feature nova: e a unica peca que faltava de uma feature que ja
-- estava inteira no codigo. A tela /dashboard/connections (596 linhas), seis
-- rotas de API e a coluna profiles.allow_connections ja existiam e ja
-- chamavam `user_connections` -- que nunca foi criada. A PostgREST responde
-- PGRST205 "Could not find the table", a tela mostra "Erro ao carregar dados"
-- e o item "Conexoes" do menu leva todo usuario logado a esse erro. Ver
-- HMO-124.
--
-- No produto, conexao nao e rede social: e a lista de pessoas com quem voce
-- divide gasto. `app/api/personal-finance/connections` le exatamente as
-- conexoes com status 'accepted' para oferecer quem pode entrar num rateio.
-- Sem a tabela, essa lista chega sempre vazia -- e dividir uma despesa com a
-- esposa so funciona dentro de um grupo.
--
-- OS NOMES DAS DUAS FOREIGN KEYS NAO SAO LIVRES
-- ----------------------------------------------
-- A tela e as rotas leem o perfil do outro lado por embed da PostgREST:
--
--     requester:profiles!user_connections_requester_id_fkey(...)
--
-- A PostgREST resolve esse embed pelo NOME da constraint. Os dois nomes abaixo
-- -- user_connections_requester_id_fkey e user_connections_requested_id_fkey --
-- sao portanto parte do contrato com o codigo que ja existe. Criar as FKs com
-- nome gerado automaticamente faria a tabela existir e as consultas
-- continuarem falhando, com um erro diferente e mais dificil de ligar a causa.
--
-- AS FKs APONTAM PARA public.profiles, NAO PARA auth.users
-- ---------------------------------------------------------
-- Pelo mesmo motivo: o embed acima so e possivel se a FK apontar para a tabela
-- que se quer embutir. Apontar para auth.users (como fazem statement_imports e
-- receipts, que nao precisam de embed) deixaria a integridade igual, porque
-- profiles.id ja e FK para auth.users(id) ON DELETE CASCADE -- mas quebraria
-- as seis chamadas.
--
-- O PAR E UNICO NOS DOIS SENTIDOS
-- --------------------------------
-- Uma UNIQUE (requester_id, requested_id) comum deixaria passar o par
-- invertido: A pede para B, B pede para A, e nascem DUAS linhas pendentes.
-- Cada um veria um pedido do outro; aceitar um deixaria o outro pendente para
-- sempre, e a tela mostraria "1 pendente" em vermelho sem nada para resolver.
-- O indice unico e sobre o par NAO ORDENADO (LEAST, GREATEST), entao o segundo
-- pedido bate em 23505 -- que e exatamente o codigo que a tela ja trata com a
-- mensagem "Solicitacao ja enviada para este usuario".
--
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: pre-requisitos
-- =====================================================
-- Sem isto a tabela nasce, as policies nascem, e so o USO em producao
-- descobre que profiles.allow_connections nao existe naquele banco.
DO $$
DECLARE
  faltando text;
BEGIN
  SELECT string_agg(msg, E'\n') INTO faltando
  FROM (
    SELECT CASE
             WHEN to_regclass('public.profiles') IS NULL
               THEN '  - tabela public.profiles nao existe'
             WHEN NOT EXISTS (
                    SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.profiles')
                      AND a.attname = r.coluna
                      AND a.attnum > 0 AND NOT a.attisdropped)
               THEN format('  - coluna public.profiles.%s nao existe', r.coluna)
           END AS msg
    FROM (VALUES ('id'), ('is_public'), ('allow_connections')) AS r(coluna)
  ) t
  WHERE msg IS NOT NULL;

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION E'010 nao pode ser aplicado neste banco:\n%', faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: a tabela
-- =====================================================
CREATE TABLE IF NOT EXISTS public.user_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    -- quem pediu
    requester_id uuid NOT NULL,
    -- quem recebeu o pedido. So ELE pode aceitar -- ver SECAO 4.
    requested_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    -- recado opcional junto do pedido ("sou eu, do grupo da viagem")
    message text,
    created_at timestamp with time zone DEFAULT now(),
    responded_at timestamp with time zone,

    CONSTRAINT user_connections_pkey PRIMARY KEY (id),

    CONSTRAINT user_connections_status_check
      CHECK (status IN ('pending', 'accepted', 'blocked')),

    -- Conectar-se consigo mesmo entraria como uma conexao aceita comum e
    -- apareceria na lista de quem pode dividir uma despesa -- o usuario
    -- poderia ratear um gasto "com ele mesmo" e o acerto do grupo passaria a
    -- ter um participante que e o proprio pagador.
    CONSTRAINT user_connections_no_self_check
      CHECK (requester_id <> requested_id),

    -- responded_at e o carimbo da resposta: existe exatamente quando ja houve
    -- resposta. Sem esta amarra, uma rota que esqueca de gravar o carimbo
    -- produz conexoes aceitas sem data, e a unica forma de perceber e olhar
    -- linha a linha no banco.
    CONSTRAINT user_connections_responded_at_check
      CHECK ((status = 'pending') = (responded_at IS NULL)),

    -- Os dois nomes abaixo sao contrato com os embeds da PostgREST. Ver o
    -- cabecalho.
    CONSTRAINT user_connections_requester_id_fkey
      FOREIGN KEY (requester_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    CONSTRAINT user_connections_requested_id_fkey
      FOREIGN KEY (requested_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.user_connections IS
  'Pedido de conexao entre duas pessoas. Conexao aceita e o que habilita dividir uma despesa fora de um grupo.';
COMMENT ON COLUMN public.user_connections.requested_id IS
  'Quem recebeu o pedido. A policy de UPDATE so permite a ELE mudar o status -- quem pede nao aceita o proprio pedido.';
COMMENT ON COLUMN public.user_connections.status IS
  'pending -> aceito pelo requested (accepted) ou recusado por ele (blocked). Nao volta para pending.';

-- =====================================================
-- SECAO 2: o par unico nos dois sentidos
-- =====================================================
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_connections_pair
  ON public.user_connections (
    LEAST(requester_id, requested_id),
    GREATEST(requester_id, requested_id)
  );

COMMENT ON INDEX public.uniq_user_connections_pair IS
  'Par nao ordenado: impede A->B e B->A coexistirem como dois pedidos pendentes. Da 23505, que a tela ja trata.';

-- =====================================================
-- SECAO 3: indices de leitura
-- =====================================================
-- A tela abre em duas consultas: "minhas conexoes aceitas" (os dois lados) e
-- "pedidos pendentes para mim". Uma so por consulta.
CREATE INDEX IF NOT EXISTS idx_user_connections_requester
  ON public.user_connections (requester_id, status);
CREATE INDEX IF NOT EXISTS idx_user_connections_requested
  ON public.user_connections (requested_id, status);

-- =====================================================
-- SECAO 4: RLS
-- =====================================================
ALTER TABLE public.user_connections ENABLE ROW LEVEL SECURITY;

-- Ver: so os dois envolvidos.
DROP POLICY IF EXISTS user_connections_select ON public.user_connections;
CREATE POLICY user_connections_select ON public.user_connections
  FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR requested_id = auth.uid());

-- Pedir: so em nome proprio, so como 'pending', e so para quem aceita pedidos.
--
-- O `status = 'pending'` no WITH CHECK e a amarra que mais importa deste
-- arquivo. Sem ele, qualquer usuario logado poderia gravar diretamente
-- (eu, a vitima, 'accepted') e passar a constar como conexao aceita da vitima
-- sem que ela clicasse em nada -- e conexao aceita e o que habilita puxar
-- alguem para o rateio de uma despesa. O consentimento fica do lado de quem
-- recebe, e so por UPDATE (abaixo).
DROP POLICY IF EXISTS user_connections_insert ON public.user_connections;
CREATE POLICY user_connections_insert ON public.user_connections
  FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = auth.uid()
    AND requested_id <> auth.uid()
    AND status = 'pending'
    AND responded_at IS NULL
    -- allow_connections e NULL-avel; o default da coluna e true, entao NULL
    -- aqui significa "nunca escolheu" e nao "recusa".
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = requested_id
         AND COALESCE(p.allow_connections, true)
    )
  );

-- Responder: so quem recebeu, e so saindo de 'pending'.
--
-- O USING prende a transicao: uma conexao ja aceita nao volta para pending e
-- um bloqueio nao vira aceite depois. O WITH CHECK impede que o requested
-- troque os participantes da linha enquanto responde.
DROP POLICY IF EXISTS user_connections_update ON public.user_connections;
CREATE POLICY user_connections_update ON public.user_connections
  FOR UPDATE TO authenticated
  USING (requested_id = auth.uid() AND status = 'pending')
  WITH CHECK (
    requested_id = auth.uid()
    AND status IN ('accepted', 'blocked')
    AND responded_at IS NOT NULL
  );

-- Apagar: depende do estado, e isto nao e detalhe.
--
--   pending   -> so quem pediu, para desistir do proprio pedido.
--   accepted  -> qualquer um dos dois, para desfazer a conexao.
--   blocked   -> SO quem bloqueou.
--
-- A ultima linha e a que sustenta o bloqueio. Com um DELETE simetrico, quem
-- foi recusado apagaria a propria linha de bloqueio e mandaria o pedido de
-- novo -- e de novo, indefinidamente. O bloqueio pareceria existir na tela de
-- quem bloqueou e nao valeria nada.
DROP POLICY IF EXISTS user_connections_delete ON public.user_connections;
CREATE POLICY user_connections_delete ON public.user_connections
  FOR DELETE TO authenticated
  USING (
       (status = 'pending'  AND requester_id = auth.uid())
    OR (status = 'accepted' AND (requester_id = auth.uid() OR requested_id = auth.uid()))
    OR (status = 'blocked'  AND requested_id = auth.uid())
  );

-- =====================================================
-- SECAO 4.1: ver o perfil de quem ja e conexao aceita
-- =====================================================
-- Policy NOVA e ADITIVA: a `profiles_select_own_or_public` do 002 fica
-- exatamente como esta. Policies permissivas se somam (OR), entao isto so
-- ACRESCENTA leitura -- e a leitura que acrescenta e o nome e o avatar de
-- alguem com quem o usuario ja concordou em se conectar.
--
-- Sem ela ha um buraco silencioso: so se encontra alguem na busca com
-- is_public = true, mas essa pessoa pode desligar o perfil publico DEPOIS. A
-- partir daquele momento o embed `profiles!user_connections_..._fkey` devolve
-- nulo, a linha e descartada no map da rota, e a pessoa simplesmente some da
-- lista de quem pode entrar num rateio -- sem erro, sem aviso, e com a conexao
-- continuando a existir na tela de Conexoes.
--
-- Nao ha recursao: a policy de SELECT de user_connections olha so auth.uid(),
-- nunca profiles.
DROP POLICY IF EXISTS profiles_select_connected ON public.profiles;
CREATE POLICY profiles_select_connected ON public.profiles
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_connections uc
     WHERE uc.status = 'accepted'
       AND ( (uc.requester_id = auth.uid() AND uc.requested_id = profiles.id)
          OR (uc.requested_id = auth.uid() AND uc.requester_id = profiles.id) )
  ));

-- =====================================================
-- SECAO 5: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes desta tabela existir, e ALL TABLES
-- e uma fotografia do momento -- nao alcanca objeto criado depois.
REVOKE ALL ON public.user_connections FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_connections TO authenticated;

-- =====================================================
-- SECAO 6: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('010', '010_user_connections',
        'Tabela user_connections, que a tela de Conexoes e seis rotas ja chamavam - HMO-124', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
