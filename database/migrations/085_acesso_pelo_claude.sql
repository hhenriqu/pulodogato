-- ===========================================================================
-- 085 -- ACESSO PELO CLAUDE (servidor MCP)
-- ===========================================================================
-- O Pulo do Gato vira um conector do Claude: a pessoa adiciona
-- `https://<app>/api/mcp` no Claude, entra com a propria conta do app e passa
-- a lancar despesas, receitas e compras parceladas conversando. Cada conexao
-- autorizada vira uma linha aqui -- o "token" que o Claude manda em toda
-- chamada (`app/api/mcp/route.ts`).
--
-- O TOKEN NAO FICA GRAVADO. So o SHA-256 dele (`token_hash`). Quem vazar esta
-- tabela nao consegue lancar nada. O prefixo (`pdg_abc1...`) fica so para a
-- tela de Configuracoes mostrar QUAL conexao e qual.
--
-- QUEM GRAVA: so o servidor, com a service role (o fim do OAuth e o botao
-- "gerar token" em Configuracoes). Nao ha policy de INSERT nem DELETE para
-- `authenticated`.
--
-- CODIGO DE USO UNICO: o codigo de autorizacao do OAuth e um pacote assinado,
-- sem tabela propria. O SHA-256 dele vai para `codigo_hash`, e o UNIQUE e o
-- que impede o mesmo codigo de virar dois tokens. Token gerado a mao em
-- Configuracoes fica com NULL (o UNIQUE aceita varios NULL).
--
-- QUEM LE E REVOGA: a propria pessoa, e so as proprias linhas. A revogacao e
-- um UPDATE de UMA coluna (`revogado_em`): o GRANT de coluna impede que alguem
-- troque o dono, o hash ou "desrevogue" pela API.
--
-- O QUE O TOKEN PODE FAZER: o servidor MCP troca o token por uma sessao normal
-- do Supabase da MESMA pessoa (como o "Entrar como" da 080) e grava com ela --
-- toda escrita passa pela RLS de sempre. O token nao e uma chave de servico.
--
-- Idempotente: roda de novo sem erro e sem duplicar policy.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.tokens_do_claude (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    nome         text        NOT NULL,
    prefixo      text        NOT NULL,
    token_hash   text        NOT NULL,
    criado_em    timestamptz NOT NULL DEFAULT now(),
    usado_em     timestamptz,
    revogado_em  timestamptz,
    codigo_hash  text,
    CONSTRAINT tokens_do_claude_hash_unico UNIQUE (token_hash),
    CONSTRAINT tokens_do_claude_codigo_unico UNIQUE (codigo_hash),
    CONSTRAINT tokens_do_claude_hash_sha256 CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT tokens_do_claude_nome_curto CHECK (char_length(nome) BETWEEN 1 AND 80),
    CONSTRAINT tokens_do_claude_revogado_depois CHECK (revogado_em IS NULL OR revogado_em >= criado_em)
);

CREATE INDEX IF NOT EXISTS tokens_do_claude_user_idx
    ON public.tokens_do_claude (user_id, criado_em DESC);

ALTER TABLE public.tokens_do_claude ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tokens_do_claude FROM anon;
REVOKE ALL ON public.tokens_do_claude FROM authenticated;
GRANT SELECT ON public.tokens_do_claude TO authenticated;
GRANT UPDATE (revogado_em) ON public.tokens_do_claude TO authenticated;
GRANT ALL ON public.tokens_do_claude TO service_role;

DROP POLICY IF EXISTS tokens_do_claude_select ON public.tokens_do_claude;
CREATE POLICY tokens_do_claude_select ON public.tokens_do_claude
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- A revogacao: so a propria linha, e so de "ativa" para "revogada". O WITH
-- CHECK exige `revogado_em` preenchido depois do UPDATE, entao "desrevogar"
-- (voltar para NULL) e recusado mesmo pela dona.
DROP POLICY IF EXISTS tokens_do_claude_revogar ON public.tokens_do_claude;
CREATE POLICY tokens_do_claude_revogar ON public.tokens_do_claude
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid() AND revogado_em IS NULL)
    WITH CHECK (user_id = auth.uid() AND revogado_em IS NOT NULL);

COMMENT ON TABLE public.tokens_do_claude IS
  'Conexoes do Claude (servidor MCP em /api/mcp). Guarda so o SHA-256 do token. So a service role cria; a dona le e revoga.';
