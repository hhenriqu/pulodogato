-- ===========================================================================
-- 081 -- O PAGAMENTO ENTRE PESSOAS CHEGA A QUEM RECEBE
-- ===========================================================================
-- O pedido (Helio, 04/11/2026, validando o fluxo da familia): ele lancou
-- "Pagamento para Lais" R$ 607,95 saindo da Conta Corrente dele, e para a Lais
-- nao apareceu nada. Fora de grupo, cada um lancava o proprio lado, e o lado de
-- quem recebe ficava esquecido.
--
-- Decisao de produto (Helio, 04/11/2026): "ela confirma com 1 clique". Quem
-- paga marca para quem foi o pagamento; para quem recebe aparece
-- "Helio te pagou R$ 607,95 -- a lancar", ela escolhe a conta em que o dinheiro
-- caiu e confirma.
--
-- POR QUE A CONFIRMACAO, E NAO A RECEITA ENTRANDO SOZINHA
-- ------------------------------------------------------
-- E a objecao 1 da 007 e o mesmo desenho do acerto de grupo (fase 12,
-- `lib/perna-da-contraparte.ts`): ninguem lanca na conta de outra pessoa. So a
-- Lais sabe em qual conta o Pix caiu; um trigger escolhendo a conta dela erraria
-- o saldo de terceiro em silencio. A perna dela nasce na SESSAO dela, pela rota
-- `app/api/pagamentos-entre-pessoas/[id]/confirmar`.
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
--   SECAO 1  preflight
--   SECAO 2  a tabela `pagamentos_entre_pessoas`
--   SECAO 3  as travas (trigger): o lancamento de quem paga e dele e e saida do
--            mesmo valor; o de quem recebe e dela e e entrada do mesmo valor; o
--            resto da linha nao muda depois de criada
--   SECAO 4  RLS e grants: os dois lados leem; quem paga cria e apaga; quem
--            recebe so preenche a propria perna ou recusa
--   SECAO 5  `meus_pagamentos_entre_pessoas()`: a lista com o nome do outro
--            lado (profiles nao e legivel entre membros que nao sao conexao)
--
-- QUEM PODE RECEBER: quem esta ATIVO num grupo onde quem paga tambem esta ATIVO
-- (`compartilha_grupo_ativo`, 032). E a familia do pedido.
--
-- O QUE ACONTECE QUANDO ALGUEM APAGA
-- ---------------------------------
--   * quem paga apaga a despesa: a linha daqui vai junto (ON DELETE CASCADE).
--     Se quem recebe ja tinha confirmado, a receita dela FICA -- e um
--     lancamento dela, e a RLS nao deixaria apagar de qualquer forma. A tela de
--     quem paga avisa antes;
--   * quem recebe apaga a propria receita: a linha volta a "a lancar"
--     (ON DELETE SET NULL), como no acerto.
--
-- O PASSO HUMANO: colar no SQL Editor do Supabase depois do merge. Idempotente.
-- ===========================================================================

-- ===========================================================================
-- SECAO 1: PREFLIGHT
-- ===========================================================================
DO $$
BEGIN
  IF to_regprocedure('public.compartilha_grupo_ativo(uuid)') IS NULL THEN
    RAISE EXCEPTION '081 precisa da 032 (compartilha_grupo_ativo)';
  END IF;
END $$;

-- ===========================================================================
-- SECAO 2: A TABELA
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.pagamentos_entre_pessoas (
    id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    pagador_id              uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    recebedor_id            uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    valor                   numeric(15,2) NOT NULL,
    data                    date          NOT NULL,
    descricao               text,
    lancamento_do_pagador   uuid          NOT NULL REFERENCES public.financial_transactions(id) ON DELETE CASCADE,
    lancamento_do_recebedor uuid          REFERENCES public.financial_transactions(id) ON DELETE SET NULL,
    recusado_em             timestamptz,
    created_at              timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT pagamentos_entre_pessoas_valor_positivo CHECK (valor > 0),
    CONSTRAINT pagamentos_entre_pessoas_outra_pessoa CHECK (pagador_id <> recebedor_id),
    CONSTRAINT pagamentos_entre_pessoas_lancado_ou_recusado
      CHECK (lancamento_do_recebedor IS NULL OR recusado_em IS NULL)
);

-- Um lancamento de quem paga vira no maximo UM pagamento, e uma receita de
-- quem recebe confirma no maximo UM.
CREATE UNIQUE INDEX IF NOT EXISTS pagamentos_entre_pessoas_lancamento_do_pagador_key
    ON public.pagamentos_entre_pessoas (lancamento_do_pagador);
CREATE UNIQUE INDEX IF NOT EXISTS pagamentos_entre_pessoas_lancamento_do_recebedor_key
    ON public.pagamentos_entre_pessoas (lancamento_do_recebedor)
 WHERE lancamento_do_recebedor IS NOT NULL;
CREATE INDEX IF NOT EXISTS pagamentos_entre_pessoas_recebedor_idx
    ON public.pagamentos_entre_pessoas (recebedor_id, data DESC);
CREATE INDEX IF NOT EXISTS pagamentos_entre_pessoas_pagador_idx
    ON public.pagamentos_entre_pessoas (pagador_id, data DESC);

COMMENT ON TABLE public.pagamentos_entre_pessoas IS
  'Pagamento de uma pessoa para outra da familia (081). Quem paga cria a partir da propria despesa; quem recebe confirma escolhendo a conta, ou recusa.';

-- ===========================================================================
-- SECAO 3: AS TRAVAS
-- ===========================================================================
-- SECURITY DEFINER porque, no UPDATE da Lais, a trava confere a despesa do
-- Helio (que a RLS nao deixa ela ler) e, no INSERT do Helio, nao precisa ler
-- nada dela. Le so as colunas de que precisa e nao devolve nada.
CREATE OR REPLACE FUNCTION public.pagamentos_entre_pessoas_trava()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_l record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT t.user_id, t.amount, t.transaction_date INTO v_l
      FROM public.financial_transactions t
     WHERE t.id = NEW.lancamento_do_pagador;

    IF NOT FOUND OR v_l.user_id IS DISTINCT FROM NEW.pagador_id THEN
      RAISE EXCEPTION 'PDG81: o lancamento de quem paga tem de ser de quem paga'
        USING ERRCODE = '23514';
    END IF;
    IF v_l.amount >= 0 OR abs(v_l.amount) <> NEW.valor THEN
      RAISE EXCEPTION 'PDG81: o pagamento tem de ser a saida do mesmo valor do lancamento'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.lancamento_do_recebedor IS NOT NULL OR NEW.recusado_em IS NOT NULL THEN
      RAISE EXCEPTION 'PDG81: o pagamento nasce a lancar'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: so a perna de quem recebe e a recusa mudam.
  IF NEW.pagador_id <> OLD.pagador_id
     OR NEW.recebedor_id <> OLD.recebedor_id
     OR NEW.valor <> OLD.valor
     OR NEW.data <> OLD.data
     OR NEW.descricao IS DISTINCT FROM OLD.descricao
     OR NEW.lancamento_do_pagador <> OLD.lancamento_do_pagador
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'PDG81: so a confirmacao de quem recebe muda depois de criado'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.lancamento_do_recebedor IS NOT NULL
     AND NEW.lancamento_do_recebedor IS DISTINCT FROM OLD.lancamento_do_recebedor THEN
    SELECT t.user_id, t.amount INTO v_l
      FROM public.financial_transactions t
     WHERE t.id = NEW.lancamento_do_recebedor;

    IF NOT FOUND OR v_l.user_id IS DISTINCT FROM NEW.recebedor_id THEN
      RAISE EXCEPTION 'PDG81: o lancamento de quem recebe tem de ser de quem recebe'
        USING ERRCODE = '23514';
    END IF;
    IF v_l.amount <> NEW.valor THEN
      RAISE EXCEPTION 'PDG81: o recebimento tem de ser a entrada do mesmo valor do pagamento'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pagamentos_entre_pessoas_trava() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pagamentos_entre_pessoas_trava ON public.pagamentos_entre_pessoas;
CREATE TRIGGER pagamentos_entre_pessoas_trava
  BEFORE INSERT OR UPDATE ON public.pagamentos_entre_pessoas
  FOR EACH ROW EXECUTE FUNCTION public.pagamentos_entre_pessoas_trava();

-- ===========================================================================
-- SECAO 4: RLS E GRANTS
-- ===========================================================================
ALTER TABLE public.pagamentos_entre_pessoas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pagamentos_entre_pessoas FROM anon;
REVOKE ALL ON public.pagamentos_entre_pessoas FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.pagamentos_entre_pessoas TO authenticated;
-- UPDATE so nas duas colunas da confirmacao. O resto a trava tambem segura,
-- mas o GRANT por coluna e a primeira barreira.
GRANT UPDATE (lancamento_do_recebedor, recusado_em) ON public.pagamentos_entre_pessoas TO authenticated;
GRANT ALL ON public.pagamentos_entre_pessoas TO service_role;

DROP POLICY IF EXISTS pagamentos_entre_pessoas_select ON public.pagamentos_entre_pessoas;
CREATE POLICY pagamentos_entre_pessoas_select ON public.pagamentos_entre_pessoas
  FOR SELECT TO authenticated
  USING (pagador_id = auth.uid() OR recebedor_id = auth.uid());

DROP POLICY IF EXISTS pagamentos_entre_pessoas_insert ON public.pagamentos_entre_pessoas;
CREATE POLICY pagamentos_entre_pessoas_insert ON public.pagamentos_entre_pessoas
  FOR INSERT TO authenticated
  WITH CHECK (
    pagador_id = auth.uid()
    AND public.compartilha_grupo_ativo(recebedor_id)
  );

DROP POLICY IF EXISTS pagamentos_entre_pessoas_update ON public.pagamentos_entre_pessoas;
CREATE POLICY pagamentos_entre_pessoas_update ON public.pagamentos_entre_pessoas
  FOR UPDATE TO authenticated
  USING (recebedor_id = auth.uid())
  WITH CHECK (recebedor_id = auth.uid());

DROP POLICY IF EXISTS pagamentos_entre_pessoas_delete ON public.pagamentos_entre_pessoas;
CREATE POLICY pagamentos_entre_pessoas_delete ON public.pagamentos_entre_pessoas
  FOR DELETE TO authenticated
  USING (pagador_id = auth.uid());

-- ===========================================================================
-- SECAO 5: A LISTA, COM O NOME DO OUTRO LADO
-- ===========================================================================
-- So as linhas de auth.uid(), sem parametro: nao ha como pedir as de outra
-- pessoa. O nome vem de profiles por aqui porque a policy de profiles so abre
-- para o proprio, perfil publico e conexao -- membro da casa que nao e conexao
-- apareceria sem nome.
DROP FUNCTION IF EXISTS public.meus_pagamentos_entre_pessoas();
CREATE FUNCTION public.meus_pagamentos_entre_pessoas()
RETURNS TABLE (
  id uuid,
  papel text,
  outra_pessoa_id uuid,
  outra_pessoa text,
  valor numeric,
  data date,
  descricao text,
  situacao text,
  lancamento_do_pagador uuid,
  lancamento_do_recebedor uuid,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p.id,
         CASE WHEN p.pagador_id = auth.uid() THEN 'paguei' ELSE 'recebi' END,
         CASE WHEN p.pagador_id = auth.uid() THEN p.recebedor_id ELSE p.pagador_id END,
         COALESCE(NULLIF(btrim(pr.full_name), ''), 'Membro')::text,
         p.valor,
         p.data,
         p.descricao,
         CASE
           WHEN p.lancamento_do_recebedor IS NOT NULL THEN 'lancado'
           WHEN p.recusado_em IS NOT NULL THEN 'recusado'
           ELSE 'a_lancar'
         END,
         CASE WHEN p.pagador_id = auth.uid() THEN p.lancamento_do_pagador END,
         CASE WHEN p.recebedor_id = auth.uid() THEN p.lancamento_do_recebedor END,
         p.created_at
    FROM public.pagamentos_entre_pessoas p
    LEFT JOIN public.profiles pr
      ON pr.id = CASE WHEN p.pagador_id = auth.uid() THEN p.recebedor_id ELSE p.pagador_id END
   WHERE auth.uid() IS NOT NULL
     AND (p.pagador_id = auth.uid() OR p.recebedor_id = auth.uid())
   ORDER BY p.data DESC, p.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.meus_pagamentos_entre_pessoas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meus_pagamentos_entre_pessoas() TO authenticated;

-- ===========================================================================
-- SECAO 6: PARA QUEM EU POSSO PAGAR
-- ===========================================================================
-- Quem esta ATIVO num grupo onde auth.uid() tambem esta ATIVO, com nome -- o
-- mesmo recorte da policy de INSERT (`compartilha_grupo_ativo`). O seletor do
-- formulario le daqui para nao oferecer quem a policy recusaria.
DROP FUNCTION IF EXISTS public.pessoas_para_pagamento();
CREATE FUNCTION public.pessoas_para_pagamento()
RETURNS TABLE (user_id uuid, nome text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (dele.user_id)
         dele.user_id,
         COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(dele.display_name), ''), 'Membro')::text
    FROM public.group_members meu
    JOIN public.group_members dele
      ON dele.group_id = meu.group_id
    LEFT JOIN public.profiles p ON p.id = dele.user_id
   WHERE auth.uid() IS NOT NULL
     AND meu.user_id = auth.uid()
     AND meu.status = 'active'
     AND dele.status = 'active'
     AND dele.user_id IS NOT NULL
     AND dele.user_id <> auth.uid()
   ORDER BY dele.user_id;
$$;

REVOKE ALL ON FUNCTION public.pessoas_para_pagamento() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pessoas_para_pagamento() TO authenticated;
