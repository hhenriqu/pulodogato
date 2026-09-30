-- 032_chave_pix_do_membro.sql
--
-- HMO-201, parte 1: "adicionar ao perfil a chave pix da pessoa para que o
-- colega do grupo possa copiar e fazer o pagamento."
--
-- ===========================================================================
-- POR QUE ISSO NAO E UMA COLUNA EM `profiles`
-- ===========================================================================
-- A leitura obvia do pedido e `ALTER TABLE profiles ADD COLUMN pix_key text`.
-- Nao da, e o motivo e uma policy que ja esta em producao desde o 002:
--
--     CREATE POLICY profiles_select_own_or_public ON public.profiles
--       FOR SELECT TO authenticated
--       USING (id = auth.uid() OR is_public = TRUE);
--
-- `profiles.is_public` tem DEFAULT TRUE (001_baseline). Ou seja: hoje, QUALQUER
-- conta autenticada do app le o perfil inteiro de praticamente todo mundo --
-- e essa leitura larga e de proposito, e o que faz a busca de pessoas para
-- conexao funcionar. Uma coluna nova em `profiles` herda essa policy sem que
-- ninguem escreva uma linha a mais.
--
-- E RLS nao tranca COLUNA: a policy decide quais LINHAS voltam, nunca quais
-- campos. Nao existe "todo mundo ve o nome, so o grupo ve o Pix" dentro de
-- `profiles`. A chave Pix de alguem costuma ser o CPF, o telefone ou o email
-- dessa pessoa; publicar isso para a base inteira de usuarios autenticados
-- porque o pedido dizia "no perfil" seria trocar um vazamento por uma
-- conveniencia de modelagem.
--
-- Entao a chave mora numa tabela propria, `user_pix_keys`, cuja unica policy de
-- leitura e: o dono, ou quem divide um grupo ATIVO com o dono. O "no perfil" do
-- pedido e sobre onde a pessoa DIGITA a chave (a tela de Perfil), e essa parte
-- e do app -- nao do lugar em que a linha e guardada.
--
-- ===========================================================================
-- A FUNCAO AUXILIAR E `SECURITY DEFINER` PELO MESMO MOTIVO DAS DO 002
-- ===========================================================================
-- A policy precisa perguntar "esta pessoa esta em algum grupo comigo?", o que
-- exige ler `group_members` de OUTRO usuario. A policy de SELECT de
-- `group_members` (002, SECAO 4) devolve so as linhas dos grupos de quem
-- pergunta, entao uma subconsulta direta responderia sempre "nao" para o lado
-- do colega -- silenciosamente, sem erro, e a chave nunca apareceria para
-- ninguem. `SECURITY DEFINER` e o que faz a pergunta ser respondida sobre a
-- tabela inteira, exatamente como `is_group_member` ja faz desde o 002.
--
-- Nao ha recursao: a funcao le `group_members`, e nenhuma policy de
-- `group_members` le `user_pix_keys`.
--
-- ===========================================================================
-- IDEMPOTENTE
-- ===========================================================================
-- Producao nao tem runner de migration: alguem cola este arquivo no SQL Editor
-- do Supabase (ver a nota no topo do 015). Rodar duas vezes tem que ser
-- inofensivo, e nenhuma linha aqui pode ser um meta-comando do psql (`\...`) --
-- uma unica delas reprova o arquivo INTEIRO no SQL Editor.

-- =====================================================
-- SECAO 1: A TABELA
-- =====================================================

CREATE TABLE IF NOT EXISTS public.user_pix_keys (
  -- PK = user_id: uma chave Pix por pessoa. O pedido e "a chave da pessoa para
  -- o colega copiar", nao um chaveiro. Uma lista traria a pergunta "qual
  -- delas?" para dentro da tela de acerto do grupo, que e justamente o lugar
  -- onde a pessoa que vai PAGAR nao tem como escolher certo.
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- A chave como a pessoa digitou. Nao normalizamos aqui de proposito: chave
  -- aleatoria, email, telefone e CPF tem formatos diferentes, e reescrever o
  -- que a pessoa digitou e a maneira mais rapida de entregar ao colega uma
  -- chave que o banco dele recusa.
  pix_key     text NOT NULL,

  -- O TIPO existe para a tela do colega saber o que esta copiando, e para o
  -- app poder formatar a exibicao sem adivinhar. 'aleatoria' e a EVP.
  pix_key_type text NOT NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_pix_keys_type_check
    CHECK (pix_key_type IN ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),

  -- Chave em branco e pior que chave ausente: a tela do colega mostraria um
  -- botao "Copiar Pix" que copia string vazia, e ele so descobre no app do
  -- banco. Linha sem chave nao deve existir -- quem apaga a chave apaga a
  -- LINHA (DELETE), e ai o app volta a dizer "esse colega nao cadastrou Pix".
  CONSTRAINT user_pix_keys_chave_nao_vazia
    CHECK (length(btrim(pix_key)) > 0),

  -- Teto defensivo. A maior chave valida e o email (77 caracteres pelo manual
  -- do Bacen); 200 deixa folga e ainda impede que este campo vire um bloco de
  -- texto que a tela do grupo nao sabe desenhar.
  CONSTRAINT user_pix_keys_chave_no_tamanho
    CHECK (length(pix_key) <= 200)
);

COMMENT ON TABLE public.user_pix_keys IS
  'Chave Pix por usuario. Fora de profiles porque profiles_select_own_or_public '
  'expoe o perfil a toda conta autenticada -- ver o cabecalho da migration 032.';

-- O carimbo de `updated_at`. `update_updated_at_column()` e do 001_baseline e
-- ja e usada por meia duzia de tabelas.
DROP TRIGGER IF EXISTS update_user_pix_keys_updated_at ON public.user_pix_keys;
CREATE TRIGGER update_user_pix_keys_updated_at
  BEFORE UPDATE ON public.user_pix_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- SECAO 2: A FUNCAO AUXILIAR
-- =====================================================

CREATE OR REPLACE FUNCTION public.compartilha_grupo_ativo(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.group_members meu
      JOIN public.group_members dele ON dele.group_id = meu.group_id
     WHERE meu.user_id = auth.uid()
       AND meu.status = 'active'
       AND dele.user_id = p_user_id
       AND dele.status = 'active'
  );
$$;

-- `status = 'active'` nos DOIS lados nao e simetria decorativa. Quem esta em
-- 'pending' (pedido de entrada pelo codigo, 029) ainda nao foi aprovado por
-- ninguem: nem pode ler a chave dos membros, nem deve ter a dele exposta ao
-- grupo em que ainda esta na fila.

-- ACL explicita, pelo mesmo motivo escrito no 002: a funcao e SECURITY DEFINER
-- e nasceria com EXECUTE para PUBLIC (o que inclui `anon`). A policy da SECAO 3
-- e avaliada como `authenticated`, e avaliacao de policy exige EXECUTE -- o
-- GRANT abaixo nao e opcional.
REVOKE ALL ON FUNCTION public.compartilha_grupo_ativo(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compartilha_grupo_ativo(UUID) TO authenticated;

-- =====================================================
-- SECAO 3: RLS
-- =====================================================

ALTER TABLE public.user_pix_keys ENABLE ROW LEVEL SECURITY;
-- FORCE para que nem o dono da tabela escape da policy em sessao normal. Nao
-- alcanca `postgres` no SQL Editor, que tem rolbypassrls.
ALTER TABLE public.user_pix_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_pix_keys_select ON public.user_pix_keys;
CREATE POLICY user_pix_keys_select ON public.user_pix_keys
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.compartilha_grupo_ativo(user_id));

DROP POLICY IF EXISTS user_pix_keys_insert ON public.user_pix_keys;
CREATE POLICY user_pix_keys_insert ON public.user_pix_keys
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- O que esta policy protege e MOVER a propria linha para outro `user_id` --
-- publicar o proprio Pix no nome de outra pessoa, a familia de defeito da
-- HMO-183. O colega do grupo copiaria a chave achando que paga a outra.
--
-- Duas coisas medidas sobre isso, porque as duas sao contraintuitivas e as
-- duas mudam o que aqui e load-bearing (ver os mutantes em
-- scripts/mutantes-chave-pix.mjs):
--
--  1. `WITH CHECK` omitido num policy de UPDATE nao afrouxa nada: o Postgres
--     reaproveita a expressao do USING para validar a linha nova
--     (`polwithcheck` nasce NULO e a escrita e barrada igual). Ele esta escrito
--     aqui por legibilidade, nao por necessidade.
--
--  2. Com a policy de UPDATE TOTALMENTE ABERTA, um `UPDATE ... WHERE ...`
--     continua sendo recusado -- porque ter WHERE obriga o Postgres a LER a
--     linha, a policy de SELECT entra, e ele ainda exige que a linha NOVA siga
--     visivel para quem escreveu. Quem barra ali e o SELECT, nao este policy.
--     O que este policy barra sozinho e o `UPDATE` SEM WHERE, que nao le nada
--     antes de escrever. E so por causa dele que o USING abaixo importa.
DROP POLICY IF EXISTS user_pix_keys_update ON public.user_pix_keys;
CREATE POLICY user_pix_keys_update ON public.user_pix_keys
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_pix_keys_delete ON public.user_pix_keys;
CREATE POLICY user_pix_keys_delete ON public.user_pix_keys
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =====================================================
-- SECAO 4: GRANTS
-- =====================================================
-- O 002 rodou `GRANT ... ON ALL TABLES` antes desta tabela existir, e ALL
-- TABLES e uma fotografia do momento: nao alcanca objeto criado depois. Sem
-- este bloco a tabela nasce sem GRANT nenhum e toda leitura volta 42501, com
-- cara de RLS.
REVOKE ALL ON public.user_pix_keys FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_pix_keys TO authenticated;
