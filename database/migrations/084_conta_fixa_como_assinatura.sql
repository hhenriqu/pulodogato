-- ===========================================================================
-- 084 -- MARCAR UMA CONTA FIXA COMO ASSINATURA
-- ===========================================================================
-- O pedido (Helio, 07/11/2026): "Nas contas fixas do cartao podemos criar um
-- check ou toggle para identificar uma conta fixa como assinatura e
-- posteriormente ela estar listada nas assinaturas pro usuario ter um controle
-- de quanto gasta com assinaturas."
--
-- A marca mora na REGRA (`recurring_rules`), e nao na ocorrencia
-- (`scheduled_transactions`): "e assinatura" e uma propriedade da conta fixa
-- inteira, nao de um mes. Marcada na ocorrencia, a de dezembro seria assinatura
-- e a de janeiro (gerada depois) nao.
--
-- NOT NULL DEFAULT false: nenhuma conta fixa existente vira assinatura sozinha.
--
-- A tela de Assinaturas (/dashboard/recurrences) passa a listar as contas fixas
-- ATIVAS com a marca, ao lado das recorrencias detectadas no extrato, e a somar
-- o custo mensal delas no "Total por mes".
--
-- IDEMPOTENTE: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
-- ===========================================================================

BEGIN;

ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS is_subscription boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.recurring_rules.is_subscription IS
  'Conta fixa marcada como assinatura (084). Aparece na tela de Assinaturas e soma no total mensal de assinaturas.';

-- A tela de Assinaturas le "as assinaturas ativas deste usuario". Parcial: a
-- imensa maioria das regras nao e assinatura.
CREATE INDEX IF NOT EXISTS recurring_rules_assinaturas_do_usuario
  ON public.recurring_rules (user_id)
  WHERE is_subscription AND is_active;

COMMIT;

-- Recarrega o cache de esquema do PostgREST para a coluna nova ser vista ja.
NOTIFY pgrst, 'reload schema';
