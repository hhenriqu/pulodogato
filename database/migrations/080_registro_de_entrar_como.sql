-- ===========================================================================
-- 080 -- O REGISTRO DO "ENTRAR COMO"
-- ===========================================================================
-- O administrador do app pode entrar na conta de quem divide um grupo com
-- ele, para conferir o fluxo da familia pelos olhos do outro membro
-- (`app/api/admin/entrar-como/route.ts`). Cada entrada vira uma linha aqui:
-- quem entrou, na conta de quem, quando entrou e quando voltou.
--
-- QUEM GRAVA: so a rota, com a service role. Nao ha policy de INSERT, UPDATE
-- nem DELETE para `authenticated`: um usuario comum nao consegue forjar,
-- apagar nem "fechar" uma entrada, nem a propria.
--
-- QUEM LE: o administrador que entrou E a pessoa cuja conta foi usada. A
-- segunda metade da policy e o ponto: quem teve a conta usada consegue ver
-- que isso aconteceu. Terceiros nao veem nada.
--
-- Idempotente: roda de novo sem erro e sem duplicar policy.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.registro_entrar_como (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    alvo_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    entrou_em   timestamptz NOT NULL DEFAULT now(),
    saiu_em     timestamptz,
    user_agent  text,
    CONSTRAINT registro_entrar_como_alvo_e_outro CHECK (admin_id <> alvo_id),
    CONSTRAINT registro_entrar_como_saida_depois CHECK (saiu_em IS NULL OR saiu_em >= entrou_em)
);

CREATE INDEX IF NOT EXISTS registro_entrar_como_admin_idx
    ON public.registro_entrar_como (admin_id, entrou_em DESC);
CREATE INDEX IF NOT EXISTS registro_entrar_como_alvo_idx
    ON public.registro_entrar_como (alvo_id, entrou_em DESC);

ALTER TABLE public.registro_entrar_como ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.registro_entrar_como FROM anon;
REVOKE ALL ON public.registro_entrar_como FROM authenticated;
GRANT SELECT ON public.registro_entrar_como TO authenticated;
GRANT ALL ON public.registro_entrar_como TO service_role;

DROP POLICY IF EXISTS registro_entrar_como_select ON public.registro_entrar_como;
CREATE POLICY registro_entrar_como_select ON public.registro_entrar_como
    FOR SELECT TO authenticated
    USING (admin_id = auth.uid() OR alvo_id = auth.uid());

COMMENT ON TABLE public.registro_entrar_como IS
  'Cada vez que o administrador entrou na conta de outro membro (Entrar como). So a service role grava; leem o admin e a pessoa cuja conta foi usada.';
